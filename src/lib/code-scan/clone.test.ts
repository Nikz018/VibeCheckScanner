import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import {
  cloneShallow,
  describeGitFailure,
  gitArgs,
  gitCloneArgs,
  installationCloneUrl,
  normalizeGitBranch,
  redactGitText,
  verifyGitAvailable,
  withIsolatedDir,
} from "./clone";
import { CODE_SCAN_FAILED_TITLE, codeScanFailurePrompt } from "./messages";

const exec = promisify(execFile);
const TOKEN = "ghs_supersecretvalue";

async function gitRepo(branch: string, commit: boolean): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "vibecheck-origin-"));
  await exec("git", ["init", "-b", branch], { cwd: dir });
  if (!commit) return dir;
  await writeFile(path.join(dir, "README.md"), "hello\n");
  await exec("git", ["add", "README.md"], { cwd: dir });
  await exec("git", ["-c", "user.email=dev@example.com", "-c", "user.name=Dev", "commit", "-m", "init"], { cwd: dir });
  return dir;
}

test("git commands set safe.directory and never receive the token", () => {
  const args = gitCloneArgs({ repoUrl: "https://github.com/Nikz018/VulnAsp.git", dest: "/tmp/example", depth: 25, branch: "main" });
  assert.deepEqual(args.slice(0, 4), ["-c", "safe.directory=*", "-c", "credential.helper="]);
  assert.ok(args.includes("--branch"));
  assert.equal(args.includes(TOKEN), false);
  assert.equal(args.some((arg) => arg.includes(TOKEN)), false);
  const head = gitArgs(["-C", "/tmp/vibecheck-code/repo", "rev-parse", "HEAD"]);
  assert.ok(head.indexOf("safe.directory=*") < head.indexOf("-C"));
  assert.deepEqual(head.slice(-4), ["-C", "/tmp/vibecheck-code/repo", "rev-parse", "HEAD"]);
  assert.equal(installationCloneUrl("https://github.com/Nikz018/VulnAsp.git"), "https://x-access-token@github.com/Nikz018/VulnAsp.git");
  assert.equal(installationCloneUrl("https://github.com/Nikz018/VulnAsp.git").includes(TOKEN), false);
  assert.equal(installationCloneUrl("/tmp/local-repo"), "/tmp/local-repo");
  assert.equal(normalizeGitBranch("  trunk  "), "trunk");
  assert.equal(normalizeGitBranch("-rf"), undefined);
  assert.equal(normalizeGitBranch("main..origin"), undefined);
});

test("git failure text keeps stderr and drops the token", () => {
  const raw = [
    "Command failed: git clone -- https://x-access-token:ghs_supersecretvalue@github.com/Nikz018/VulnAsp.git",
    "fatal: Authentication failed for 'https://x-access-token:ghs_supersecretvalue@github.com/Nikz018/VulnAsp.git'",
    "Authorization: Bearer ghs_supersecretvalue",
  ].join("\n");
  const cleaned = redactGitText(raw, [TOKEN]);
  assert.equal(cleaned.includes(TOKEN), false);
  assert.match(cleaned, /x-access-token:\[redacted\]/);
  assert.match(cleaned, /fatal: Authentication failed/);
  const described = describeGitFailure({ message: "Command failed: git rev-parse HEAD", stderr: raw }, [TOKEN]);
  assert.equal(described.includes(TOKEN), false);
  assert.match(described, /rev-parse HEAD/);
  assert.match(described, /fatal: Authentication failed/);
});

test("worker git check reports the installed version", () => {
  const git = verifyGitAvailable();
  assert.equal(git.ok, true);
  if (git.ok) assert.match(git.version, /^git version /);
});

test("a missing branch falls back to the GitHub default branch and logs stderr without the token", async () => {
  const source = await gitRepo("trunk", true);
  try {
    const logs: string[] = [];
    let lookups = 0;
    await withIsolatedDir(async (dir) => {
      const result = await cloneShallow({
        repoUrl: source,
        dest: path.join(dir, "repo"),
        depth: 1,
        branch: "missing-branch",
        token: TOKEN,
        log: (message) => logs.push(message),
        resolveDefaultBranch: async () => {
          lookups += 1;
          return "trunk";
        },
      });
      assert.equal(result.empty, false);
      assert.match(result.commit ?? "", /^[0-9a-f]{40}$/);
    });
    assert.equal(lookups, 1);
    assert.match(logs.join("\n"), /missing-branch/i);
    assert.equal(logs.join("\n").includes(TOKEN), false);
  } finally {
    await rm(source, { recursive: true, force: true });
  }
});

test("a wrong branch still clones the remote HEAD when no API branch is available", async () => {
  const source = await gitRepo("trunk", true);
  try {
    await withIsolatedDir(async (dir) => {
      const result = await cloneShallow({
        repoUrl: source,
        dest: path.join(dir, "repo"),
        depth: 1,
        branch: "does-not-exist",
        log: () => undefined,
      });
      assert.equal(result.empty, false);
      assert.match(result.commit ?? "", /^[0-9a-f]{40}$/);
    });
  } finally {
    await rm(source, { recursive: true, force: true });
  }
});

test("an empty repository is reported instead of failing rev-parse", async () => {
  const source = await gitRepo("main", false);
  try {
    await withIsolatedDir(async (dir) => {
      const result = await cloneShallow({
        repoUrl: source,
        dest: path.join(dir, "repo"),
        depth: 1,
        branch: "main",
        log: () => undefined,
      });
      assert.deepEqual(result, { commit: null, empty: true });
    });
  } finally {
    await rm(source, { recursive: true, force: true });
  }
});

test("a clone that cannot start includes git stderr and not the token", async () => {
  const logs: string[] = [];
  await withIsolatedDir(async (dir) => {
    await assert.rejects(
      () =>
        cloneShallow({
          repoUrl: path.join(dir, "missing-origin"),
          dest: path.join(dir, "repo"),
          token: TOKEN,
          log: (message) => logs.push(message),
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message.includes(TOKEN), false);
        assert.match(error.message, /fatal|not a git repository|does not exist|repository/i);
        return true;
      },
    );
  });
  assert.equal(logs.join("\n").includes(TOKEN), false);
  assert.match(logs.join("\n"), /fatal|not a git repository|does not exist|repository/i);
});

test("safe.directory lets rev-parse read a repository owned by another user", async (t) => {
  const source = await gitRepo("trunk", true);
  const root = await mkdtemp(path.join(tmpdir(), "vibecheck-owned-"));
  const dest = path.join(root, "repo");
  const restore = async () => {
    await exec("sudo", ["-n", "chown", "-R", `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`, root]).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  };
  try {
    await exec("git", gitCloneArgs({ repoUrl: source, dest, depth: 1 }), { timeout: 20_000 });
    try {
      await exec("sudo", ["-n", "chown", "-R", "nobody:nogroup", dest]);
    } catch {
      t.skip("cannot change repository ownership here");
      return;
    }
    await assert.rejects(exec("git", ["-C", dest, "rev-parse", "HEAD"], { timeout: 10_000 }));
    const { stdout } = await exec("git", gitArgs(["-C", dest, "rev-parse", "HEAD"]), { timeout: 10_000 });
    assert.match(stdout.trim(), /^[0-9a-f]{40}$/);
  } finally {
    await restore();
  }
});

test("a failed code scan is named on the report and can be retried without a new charge", () => {
  assert.equal(CODE_SCAN_FAILED_TITLE, "We couldn't scan your code this time");
  assert.deepEqual(
    codeScanFailurePrompt({ scanId: "scan_1", scanStatus: "completed", repoConnected: true, report: { status: "failed" } }),
    { href: "/scans/scan_1#code-scan", label: CODE_SCAN_FAILED_TITLE },
  );
  assert.equal(codeScanFailurePrompt({ scanId: "scan_1", scanStatus: "running", repoConnected: true, report: { status: "failed" } }), null);
  assert.equal(codeScanFailurePrompt({ scanId: "scan_1", scanStatus: "completed", repoConnected: false, report: { status: "completed" } }), null);
  assert.deepEqual(
    codeScanFailurePrompt({ scanId: "scan_1", scanStatus: "completed", repoConnected: true, report: null }),
    { href: "/scans/scan_1#code-scan", label: CODE_SCAN_FAILED_TITLE },
  );
  const panel = readFileSync(path.join(process.cwd(), "src/components/CodeScanPanel.tsx"), "utf8");
  const button = readFileSync(path.join(process.cwd(), "src/components/RunCodeScanButton.tsx"), "utf8");
  assert.match(panel, /CODE_SCAN_FAILED_TITLE/);
  assert.match(panel, /CODE_SCAN_RETRY_LABEL/);
  assert.match(panel, /CODE_SCAN_RETRY_NOTE/);
  assert.match(button, /\/api\/projects\/\$\{projectId\}\/code-scan/);
  const dashboard = readFileSync(path.join(process.cwd(), "src/app/dashboard/page.tsx"), "utf8");
  assert.match(dashboard, /codeScanFailurePrompt/);
});
