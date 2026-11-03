import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  GITHUB_CONTENTS_READ_DENIED,
  GITHUB_REPO_READ_DENIED,
  confirmRepositoryReadable,
  fetchRepositoryDefaultBranch,
  interpretRepoReadToken,
  githubInstallUrl,
  normalizePem,
  readGithubState,
  safeAppPath,
  signGithubState,
  verifyGithubWebhook,
} from "./app";

test("GitHub state round-trips and rejects a bad signature", () => {
  const secret = "session-secret-for-tests-32chars";
  const state = signGithubState({ projectId: "proj_1", userId: "user_1" }, secret, 1_700_000_000_000);
  assert.deepEqual(readGithubState(state, secret, 1_700_000_000_000), { projectId: "proj_1", userId: "user_1", next: null });
  const back = signGithubState({ projectId: "proj_1", userId: "user_1", next: "/scans/scan_1?checkout=success" }, secret, 1_700_000_000_000);
  assert.equal(readGithubState(back, secret, 1_700_000_000_000)?.next, "/scans/scan_1?checkout=success");
  const dropped = signGithubState({ projectId: "proj_1", userId: "user_1", next: "https://evil.example/scans" }, secret, 1_700_000_000_000);
  assert.equal(readGithubState(dropped, secret, 1_700_000_000_000)?.next, null);
  assert.equal(safeAppPath("//evil.example"), null);
  assert.equal(safeAppPath("/scans/scan_1?checkout=success"), "/scans/scan_1?checkout=success");
  assert.equal(readGithubState(state, "other-secret-for-tests-32chars", 1_700_000_000_000), null);
  assert.equal(readGithubState(state, secret, 1_700_000_000_000 + 20 * 60 * 1000), null);
  const url = githubInstallUrl("vibecheck", state);
  assert.match(url, /^https:\/\/github\.com\/apps\/vibecheck\/installations\/new\?state=/);
});

test("webhook signatures use the raw body", () => {
  const secret = "webhook-secret";
  const body = JSON.stringify({ action: "deleted", installation: { id: 9 } });
  const signature = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
  assert.equal(verifyGithubWebhook(body, signature, secret), true);
  assert.equal(verifyGithubWebhook(body, signature, "other"), false);
  assert.equal(verifyGithubWebhook(`${body} `, signature, secret), false);
  assert.equal(verifyGithubWebhook(body, null, secret), false);
});

test("default branch lookup uses the installation token and ignores a failed response", async () => {
  const seen: string[] = [];
  const branch = await fetchRepositoryDefaultBranch({
    token: "ghs_lookup_token",
    owner: "Nikz018",
    name: "VulnAsp",
    fetchImpl: async (url, init) => {
      seen.push(String(url));
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer ghs_lookup_token");
      return new Response(JSON.stringify({ default_branch: "master" }), { status: 200 });
    },
  });
  assert.equal(branch, "master");
  assert.deepEqual(seen, ["https://api.github.com/repos/Nikz018/VulnAsp"]);
  const missing = await fetchRepositoryDefaultBranch({
    token: "ghs_lookup_token",
    owner: "Nikz018",
    name: "VulnAsp",
    fetchImpl: async () => new Response("no", { status: 404 }),
  });
  assert.equal(missing, null);
});

test("a code-scan token must include the repository and contents read", async () => {
  assert.deepEqual(interpretRepoReadToken(422, {}), { ok: false, reason: GITHUB_REPO_READ_DENIED });
  assert.deepEqual(interpretRepoReadToken(404, {}), { ok: false, reason: GITHUB_REPO_READ_DENIED });
  assert.deepEqual(interpretRepoReadToken(201, { token: "ghs_scoped", permissions: { contents: "none" } }), {
    ok: false,
    reason: GITHUB_CONTENTS_READ_DENIED,
  });
  assert.deepEqual(interpretRepoReadToken(201, { token: "ghs_scoped", permissions: { contents: "read" } }), {
    ok: true,
    token: "ghs_scoped",
  });
  const readable = await confirmRepositoryReadable({
    token: "ghs_lookup_token",
    owner: "Nikz018",
    name: "VulnAsp",
    fetchImpl: async (url, init) => {
      assert.equal(String(url), "https://api.github.com/repos/Nikz018/VulnAsp");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer ghs_lookup_token");
      return new Response(JSON.stringify({ default_branch: "main" }), { status: 200 });
    },
  });
  assert.deepEqual(readable, { ok: true, defaultBranch: "main" });
  const missing = await confirmRepositoryReadable({
    token: "ghs_lookup_token",
    owner: "Nikz018",
    name: "VulnAsp",
    fetchImpl: async () => new Response("missing", { status: 404 }),
  });
  assert.deepEqual(missing, { ok: false, reason: GITHUB_REPO_READ_DENIED });
});

test("private key newlines are restored from env text", () => {
  const pem = normalizePem("\"-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\"");
  assert.match(pem, /^-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----$/);
});
