import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const exec = promisify(execFile);

export const CLONE_DEPTH = 25;

/** Passed on every git invocation so a container user can read a repo it just cloned. */
export const GIT_SAFE_DIRECTORY_ARGS = ["-c", "safe.directory=*", "-c", "credential.helper="] as const;

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

export function gitCloneArgs(input: { repoUrl: string; dest: string; depth: number; branch?: string }): string[] {
  const args = ["clone", "--depth", String(Math.max(1, Math.floor(input.depth))), "--single-branch"];
  if (input.branch) args.push("--branch", input.branch);
  args.push("--", input.repoUrl, input.dest);
  return gitArgs(args);
}

/** Drop a branch name git would treat as an option or a refspec. */
export function normalizeGitBranch(value: string | null | undefined): string | undefined {
  const branch = value?.trim();
  if (!branch) return undefined;
  if (branch.startsWith("-") || branch.includes("..") || branch.includes("@{") || /[\s~^:\\?*\[]/.test(branch)) return undefined;
  return branch;
}

/**
 * GitHub installation tokens authenticate as the username `x-access-token`.
 * The token itself stays in the askpass environment, never in the URL or argv.
 */
export function installationCloneUrl(repoUrl: string): string {
  let url: URL;
  try {
    url = new URL(repoUrl);
  } catch {
    return repoUrl;
  }
  if (url.protocol !== "https:") return repoUrl;
  url.username = "x-access-token";
  url.password = "";
  return url.toString();
}

export function redactGitText(text: string, secrets: Array<string | null | undefined> = []): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret || secret.length < 8) continue;
    out = out.split(secret).join("[redacted]");
    out = out.split(encodeURIComponent(secret)).join("[redacted]");
  }
  out = out.replace(/x-access-token:[^@\s'"]+/gi, "x-access-token:[redacted]");
  out = out.replace(/\bgh[pousr]_[A-Za-z0-9_]+\b/g, "[redacted]");
  out = out.replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, "[redacted]");
  out = out.replace(/(Authorization:\s*(?:Basic|Bearer)\s+)\S+/gi, "$1[redacted]");
  return out;
}

export function describeGitFailure(error: unknown, secrets: Array<string | null | undefined> = []): string {
  const err = error as { message?: string; stderr?: string | Buffer; stdout?: string | Buffer };
  const stderr = chunkText(err?.stderr).trim();
  const stdout = chunkText(err?.stdout).trim();
  const message = typeof err?.message === "string" && err.message ? err.message : "git failed";
  const parts = [message];
  if (stderr) parts.push(stderr);
  if (stdout && stdout !== stderr) parts.push(stdout);
  return redactGitText(parts.join("\n"), secrets).slice(0, 4000);
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
 * Shallow clone. A token is passed only through the child environment, never as an argument.
 * The askpass file is removed before this function returns.
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
  const parent = path.dirname(input.dest);
  const askpass = path.join(parent, ".askpass");
  const secrets = [input.token];
  const log = input.log ?? ((message: string) => console.error("code scan git", message));
  const env = gitCommandEnv();
  const repoUrl = input.token ? installationCloneUrl(input.repoUrl) : input.repoUrl;
  if (input.token) {
    const script = [
      "#!/bin/sh",
      "case \"$1\" in",
      "  *sername*) printf '%s\\n' 'x-access-token' ;;",
      "  *) printf '%s\\n' \"$VIBECHECK_GIT_TOKEN\" ;;",
      "esac",
      "",
    ].join("\n");
    await writeFile(askpass, script, { mode: 0o700 });
    env.GIT_ASKPASS = askpass;
    env.SSH_ASKPASS = askpass;
    env.VIBECHECK_GIT_TOKEN = input.token;
  }
  const depth = input.depth ?? CLONE_DEPTH;
  const tried = new Set<string>();
  let lastFailure = "git clone failed";

  const attempt = async (branch: string | undefined): Promise<boolean> => {
    const key = branch ?? "";
    if (tried.has(key)) return false;
    tried.add(key);
    await rm(input.dest, { recursive: true, force: true });
    try {
      await runGit(gitCloneArgs({ repoUrl, dest: input.dest, depth, branch }), env, 60_000);
      return true;
    } catch (error) {
      lastFailure = describeGitFailure(error, secrets);
      log(lastFailure);
      return false;
    }
  };

  try {
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
  } finally {
    if (input.token) await rm(askpass, { force: true });
  }
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
