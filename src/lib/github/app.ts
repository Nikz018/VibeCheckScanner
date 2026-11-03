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
  const body = (await response.json()) as { token?: string };
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
