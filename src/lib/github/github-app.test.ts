import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { githubInstallUrl, normalizePem, readGithubState, signGithubState, verifyGithubWebhook } from "./app";

test("GitHub state round-trips and rejects a bad signature", () => {
  const secret = "session-secret-for-tests-32chars";
  const state = signGithubState({ projectId: "proj_1", userId: "user_1" }, secret, 1_700_000_000_000);
  assert.deepEqual(readGithubState(state, secret, 1_700_000_000_000), { projectId: "proj_1", userId: "user_1" });
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

test("private key newlines are restored from env text", () => {
  const pem = normalizePem("\"-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\"");
  assert.match(pem, /^-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----$/);
});
