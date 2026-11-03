import crypto from "node:crypto";

export interface GithubAppConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  slug: string;
}

export function normalizePem(value: string | undefined): string {
  if (!value) return "";
  let key = value.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, "\n");
}

export function githubAppConfig(): GithubAppConfig | null {
  const appId = process.env.GITHUB_APP_ID?.trim() ?? "";
  const privateKey = normalizePem(process.env.GITHUB_APP_PRIVATE_KEY);
  const webhookSecret = process.env.GITHUB_APP_WEBHOOK_SECRET?.trim() ?? "";
  const slug = process.env.GITHUB_APP_SLUG?.trim() ?? "";
  if (!appId || !privateKey || !webhookSecret || !slug) return null;
  return { appId, privateKey, webhookSecret, slug };
}

/** A same-origin path the GitHub install flow is allowed to return to. */
export function safeAppPath(value: string | null | undefined): string | null {
  if (!value) return null;
  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.includes("://")) return null;
  if (/[\u0000-\u001f]/.test(path)) return null;
  return path;
}

export function signGithubState(input: { projectId: string; userId: string; next?: string | null }, secret: string, now = Date.now()): string {
  const next = safeAppPath(input.next);
  const body = Buffer.from(JSON.stringify({ projectId: input.projectId, userId: input.userId, exp: now + 15 * 60 * 1000, ...(next ? { next } : {}) })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readGithubState(state: string, secret: string, now = Date.now()): { projectId: string; userId: string; next: string | null } | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { projectId?: unknown; userId?: unknown; exp?: unknown; next?: unknown };
    if (typeof parsed.projectId !== "string" || typeof parsed.userId !== "string" || typeof parsed.exp !== "number") return null;
    if (parsed.exp < now) return null;
    const next = typeof parsed.next === "string" ? safeAppPath(parsed.next) : null;
    return { projectId: parsed.projectId, userId: parsed.userId, next };
  } catch {
    return null;
  }
}

export function githubInstallUrl(slug: string, state: string): string {
  const url = new URL(`https://github.com/apps/${encodeURIComponent(slug)}/installations/new`);
  url.searchParams.set("state", state);
  return url.toString();
}

export function githubAppJwt(appId: string, privateKey: string, now = Math.floor(Date.now() / 1000)): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId })).toString("base64url");
  const data = `${header}.${payload}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(data);
  const signature = signer.sign(privateKey).toString("base64url");
  return `${data}.${signature}`;
}

export function verifyGithubWebhook(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const got = signature.slice("sha256=".length);
  const left = Buffer.from(got);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export interface GithubRepo {
  id: string;
  owner: string;
  name: string;
  defaultBranch: string;
}

interface GithubRepoResponse {
  id?: number;
  name?: string;
  default_branch?: string;
  owner?: { login?: string };
}

export async function fetchInstallationRepos(input: {
  appId: string;
  privateKey: string;
  installationId: string;
  fetchImpl?: typeof fetch;
}): Promise<GithubRepo[]> {
  const token = await fetchInstallationToken(input);
  const response = await (input.fetchImpl ?? fetch)(`https://api.github.com/installation/repositories?per_page=100`, {
    headers: githubHeaders(token),
  });
  if (!response.ok) throw new Error("github repo list failed");
  const body = (await response.json()) as { repositories?: GithubRepoResponse[] };
  return (body.repositories ?? [])
    .filter((repo) => repo.id && repo.name && repo.owner?.login)
    .map((repo) => ({
      id: String(repo.id),
      owner: repo.owner?.login ?? "",
      name: repo.name ?? "",
      defaultBranch: repo.default_branch || "main",
    }));
}

/** The branch GitHub currently treats as the default. Null when the API does not answer. */
export async function fetchRepositoryDefaultBranch(input: {
  token: string;
  owner: string;
  name: string;
  fetchImpl?: typeof fetch;
}): Promise<string | null> {
  const response = await (input.fetchImpl ?? fetch)(
    `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}`,
    { headers: githubHeaders(input.token) },
  );
  if (!response.ok) {
    console.error("github default branch lookup failed", response.status);
    return null;
  }
  const body = (await response.json()) as { default_branch?: string };
  const branch = body.default_branch?.trim();
  return branch || null;
}

export const GITHUB_REPO_READ_DENIED =
  "The GitHub connection cannot read this repository. Reconnect it and grant access to the repository contents.";
export const GITHUB_CONTENTS_READ_DENIED =
  "The GitHub connection is not allowed to read code. Reconnect the app and allow read access to repository contents.";

interface InstallationTokenBody {
  token?: string;
  permissions?: { contents?: string };
}

/**
 * Installation token scoped to one repository with contents read.
 * A 403, 404, or 422 means this installation does not include that repo or that permission.
 */
export function interpretRepoReadToken(
  status: number,
  body: { token?: string; permissions?: { contents?: string } },
): { ok: true; token: string } | { ok: false; reason: string } {
  if (status === 403 || status === 404 || status === 422) return { ok: false, reason: GITHUB_REPO_READ_DENIED };
  if (status < 200 || status >= 300) return { ok: false, reason: "GitHub could not create a token for this repository." };
  if (!body.token) return { ok: false, reason: "GitHub could not create a token for this repository." };
  const contents = body.permissions?.contents;
  if (contents && contents !== "read" && contents !== "write") return { ok: false, reason: GITHUB_CONTENTS_READ_DENIED };
  return { ok: true, token: body.token };
}

export async function createRepoReadToken(input: {
  appId: string;
  privateKey: string;
  installationId: string;
  repoName: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; token: string } | { ok: false; reason: string }> {
  const jwt = githubAppJwt(input.appId, input.privateKey);
  const response = await (input.fetchImpl ?? fetch)(`https://api.github.com/app/installations/${encodeURIComponent(input.installationId)}/access_tokens`, {
    method: "POST",
    headers: { ...githubHeaders(jwt), "content-type": "application/json" },
    body: JSON.stringify({
      repositories: [input.repoName],
      permissions: { contents: "read", metadata: "read" },
    }),
  });
  const body = (await response.json().catch(() => ({}))) as InstallationTokenBody;
  if (!response.ok) console.error("github installation token failed", response.status);
  return interpretRepoReadToken(response.status, body);
}

/** Confirms the installation token can see this repository before git runs. */
export async function confirmRepositoryReadable(input: {
  token: string;
  owner: string;
  name: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; defaultBranch: string } | { ok: false; reason: string }> {
  const response = await (input.fetchImpl ?? fetch)(
    `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}`,
    { headers: githubHeaders(input.token) },
  );
  if (response.status === 404 || response.status === 403) return { ok: false, reason: GITHUB_REPO_READ_DENIED };
  if (!response.ok) {
    console.error("github repo access check failed", response.status);
    return { ok: false, reason: "GitHub could not confirm access to this repository." };
  }
  const body = (await response.json()) as { default_branch?: string };
  return { ok: true, defaultBranch: body.default_branch?.trim() || "main" };
}

export async function fetchInstallationToken(input: {
  appId: string;
  privateKey: string;
  installationId: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const jwt = githubAppJwt(input.appId, input.privateKey);
  const response = await (input.fetchImpl ?? fetch)(`https://api.github.com/app/installations/${encodeURIComponent(input.installationId)}/access_tokens`, {
    method: "POST",
    headers: githubHeaders(jwt),
  });
  if (!response.ok) throw new Error("github installation token failed");
  const body = (await response.json()) as InstallationTokenBody;
  if (!body.token) throw new Error("github installation token missing");
  return body.token;
}

function githubHeaders(token: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": "VibeCheck",
    "x-github-api-version": "2022-11-28",
  };
}
