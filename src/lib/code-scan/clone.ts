import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const exec = promisify(execFile);

export const CLONE_DEPTH = 25;

/** Passed on every git invocation so a container user can read a repo it just cloned. */
export const GIT_SAFE_DIRECTORY_ARGS = ["-c", "safe.directory=*"] as const;

export function gitArgs(args: string[]): string[] {
  return [...GIT_SAFE_DIRECTORY_ARGS, ...args];
}

export function gitCommandEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "safe.directory",
    GIT_CONFIG_VALUE_0: "*",
  };
}

/** Basic auth for a GitHub installation token. The value is base64, never the raw token. */
export function gitCloneAuthArgs(token: string): string[] {
  const basic = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  return ["-c", `http.extraHeader=Authorization: Basic ${basic}`];
}

export function gitCloneArgs(input: { repoUrl: string; dest: string; depth: number; branch?: string; token?: string }): string[] {
  const args = ["clone", "--depth", String(Math.max(1, Math.floor(input.depth))), "--single-branch"];
  if (input.branch) args.push("--branch", input.branch);
  args.push("--", input.repoUrl, input.dest);
  const auth = input.token ? gitCloneAuthArgs(input.token) : [];
  return [...GIT_SAFE_DIRECTORY_ARGS, ...auth, ...args];
}

/** Drop a branch name git would treat as an option or a refspec. */
export function normalizeGitBranch(value: string | null | undefined): string | undefined {
  const branch = value?.trim();
  if (!branch) return undefined;
  if (branch.startsWith("-") || branch.includes("..") || branch.includes("@{") || /[\s~^:\\?*\[]/.test(branch)) return undefined;
  return branch;
}

export function redactGitText(text: string, secrets: Array<string | null | undefined> = []): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret || secret.length < 8) continue;
    out = out.split(secret).join("[redacted]");
    out = out.split(encodeURIComponent(secret)).join("[redacted]");
  }
  out = out.replace(/http\.extraheader=Authorization:\s*Basic\s+\S+/gi, "http.extraHeader=Authorization: Basic [redacted]");
  out = out.replace(/x-access-token:[^@\s'"]+/gi, "x-access-token:[redacted]");
  out = out.replace(/\bgh[pousr]_[A-Za-z0-9_]+\b/g, "[redacted]");
  out = out.replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, "[redacted]");
  out = out.replace(/(Authorization:\s*(?:Basic|Bearer)\s+)\S+/gi, "$1[redacted]");
  return out;
}

export function describeGitFailure(error: unknown, secrets: Array<string | null | undefined> = []): string {
  const err = error as { message?: string; stderr?: string | Buffer; stdout?: string | Buffer; code?: number | string };
  const stderr = chunkText(err?.stderr).trim();
  const stdout = chunkText(err?.stdout).trim();
  const message = typeof err?.message === "string" && err.message ? err.message : "git failed";
  const parts: string[] = [];
  if (typeof err?.code === "number" || (typeof err?.code === "string" && err.code)) parts.push(`exit ${err.code}`);
  if (stderr) parts.push(stderr);
  if (stdout && stdout !== stderr) parts.push(stdout);
  parts.push(message);
  return redactGitText(parts.join("\n"), secrets).slice(0, 16_000);
}

function chunkText(value: string | Buffer | undefined): string {
  if (!value) return "";
  return Buffer.isBuffer(value) ? value.toString("utf8") : value;
}

export function verifyGitAvailable(): { ok: true; version: string } | { ok: false; error: string } {
  try {
    const version = execFileSync("git", ["--version"], { encoding: "utf8", timeout: 5_000 }).trim();
    if (!version) return { ok: false, error: "git --version returned no output" };
    return { ok: true, version };
  } catch (error) {
    return { ok: false, error: describeGitFailure(error) };
  }
}

export interface CloneResult {
  commit: string | null;
  empty: boolean;
}

/**
 * Shallow clone. An installation token is sent as an HTTP Basic header on the clone command.
 * The header is redacted from every log line. It is not written into the repository URL.
 * A missing branch is retried against `resolveDefaultBranch`, then against the remote HEAD.
 * An empty repository returns `{ empty: true }` instead of failing `rev-parse`.
 */
export async function cloneShallow(input: {
  repoUrl: string;
  dest: string;
  depth?: number;
  branch?: string;
  token?: string;
  resolveDefaultBranch?: () => Promise<string | null>;
  log?: (message: string) => void;
}): Promise<CloneResult> {
  const basic = input.token ? Buffer.from(`x-access-token:${input.token}`, "utf8").toString("base64") : undefined;
  const secrets = [input.token, basic];
  const log = input.log ?? ((message: string) => console.error("code scan git", message));
  const env = gitCommandEnv();
  const repoUrl = input.repoUrl;
  const depth = input.depth ?? CLONE_DEPTH;
  const tried = new Set<string>();
  let lastFailure = "git clone failed";

  const attempt = async (branch: string | undefined): Promise<boolean> => {
    const key = branch ?? "";
    if (tried.has(key)) return false;
    tried.add(key);
    await rm(input.dest, { recursive: true, force: true });
    try {
      await runGit(gitCloneArgs({ repoUrl, dest: input.dest, depth, branch, token: input.token }), env, 60_000);
      return true;
    } catch (error) {
      lastFailure = describeGitFailure(error, secrets);
      log(lastFailure);
      return false;
    }
  };

  let cloned = false;
  const stored = normalizeGitBranch(input.branch);
  if (stored) cloned = await attempt(stored);
  if (!cloned && input.resolveDefaultBranch) {
    let apiBranch: string | undefined;
    try {
      apiBranch = normalizeGitBranch(await input.resolveDefaultBranch());
    } catch (error) {
      log(redactGitText(error instanceof Error ? error.message : "default branch lookup failed", secrets));
    }
    if (apiBranch) cloned = await attempt(apiBranch);
  }
  if (!cloned) cloned = await attempt(undefined);
  if (!cloned) throw new Error(lastFailure);
  return await readCloneHead(input.dest, env, secrets, log);
}

async function readCloneHead(
  dest: string,
  env: NodeJS.ProcessEnv,
  secrets: Array<string | null | undefined>,
  log: (message: string) => void,
): Promise<CloneResult> {
  if (await repositoryHasNoCommits(dest, env)) return { commit: null, empty: true };
  try {
    const { stdout } = await runGit(gitArgs(["-C", dest, "rev-parse", "HEAD"]), env, 10_000);
    const commit = stdout.trim();
    if (!commit) return { commit: null, empty: true };
    return { commit, empty: false };
  } catch (error) {
    const detail = describeGitFailure(error, secrets);
    log(detail);
    throw new Error(detail);
  }
}

async function repositoryHasNoCommits(dest: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    const inside = await runGit(gitArgs(["-C", dest, "rev-parse", "--is-inside-work-tree"]), env, 10_000);
    if (inside.stdout.trim() !== "true") return false;
    const list = await runGit(gitArgs(["-C", dest, "rev-list", "-n", "1", "--all"]), env, 10_000);
    return list.stdout.trim() === "";
  } catch {
    return false;
  }
}

async function runGit(args: string[], env: NodeJS.ProcessEnv, timeout: number): Promise<{ stdout: string; stderr: string }> {
  const result = await exec("git", args, {
    env,
    timeout,
    maxBuffer: 2_000_000,
    encoding: "utf8",
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

/** Isolated temp directory. The directory is removed when `run` finishes or throws. */
export async function withIsolatedDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "vibecheck-code-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
