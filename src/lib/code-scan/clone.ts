import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const exec = promisify(execFile);

export const CLONE_DEPTH = 25;

export function gitCloneArgs(input: { repoUrl: string; dest: string; depth: number; branch?: string }): string[] {
  const args = ["clone", "--depth", String(Math.max(1, Math.floor(input.depth))), "--single-branch"];
  if (input.branch) args.push("--branch", input.branch);
  args.push("--", input.repoUrl, input.dest);
  return args;
}

/**
 * Shallow clone. A token is passed only through the child environment, never as an argument.
 * The askpass file is removed before this function returns.
 */
export async function cloneShallow(input: {
  repoUrl: string;
  dest: string;
  depth?: number;
  branch?: string;
  token?: string;
}): Promise<{ commit: string }> {
  const parent = path.dirname(input.dest);
  const askpass = path.join(parent, ".askpass");
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
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
  try {
    try {
      await exec("git", gitCloneArgs({ repoUrl: input.repoUrl, dest: input.dest, depth, branch: input.branch }), {
        env,
        timeout: 60_000,
        maxBuffer: 1_000_000,
      });
    } catch (error) {
      if (!input.branch) throw error;
      await rm(input.dest, { recursive: true, force: true });
      await exec("git", gitCloneArgs({ repoUrl: input.repoUrl, dest: input.dest, depth }), {
        env,
        timeout: 60_000,
        maxBuffer: 1_000_000,
      });
    }
    const { stdout } = await exec("git", ["-C", input.dest, "rev-parse", "HEAD"], { env, timeout: 10_000 });
    return { commit: stdout.trim() };
  } finally {
    if (input.token) await rm(askpass, { force: true });
  }
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
