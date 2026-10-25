import assert from "node:assert/strict";
import test from "node:test";
import { assertLoginPost, assertReadOnlyMethod, guardedRequest, isActionUrl } from "./readonly";

test("logged-in probes refuse mutating methods and allow the login POST only", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.throws(() => assertReadOnlyMethod(method), /read-only/);
  }
  assert.doesNotThrow(() => assertReadOnlyMethod("GET"));
  assert.doesNotThrow(() => assertReadOnlyMethod("HEAD"));
  assert.throws(() => assertLoginPost("DELETE", "http://127.0.0.1:4013/login", ["http://127.0.0.1:4013/login"]), /read-only/);
  assert.throws(() => assertLoginPost("POST", "http://127.0.0.1:4013/api/notes/u_alice", ["http://127.0.0.1:4013/login"]), /read-only/);
  assert.doesNotThrow(() => assertLoginPost("POST", "http://127.0.0.1:4013/login", ["http://127.0.0.1:4013/login"]));

  let ran = false;
  await guardedRequest("GET", "http://127.0.0.1:4013/api/notes/u_alice", null, async () => {
    ran = true;
  });
  assert.equal(ran, true);
  await assert.rejects(guardedRequest("POST", "http://127.0.0.1:4013/api/notes/u_alice", ["http://127.0.0.1:4013/login"], async () => undefined), /read-only/);
  await assert.rejects(guardedRequest("DELETE", "http://127.0.0.1:4013/api/notes/u_alice", null, async () => undefined), /read-only/);

  assert.equal(isActionUrl("http://127.0.0.1:4013/logout"), true);
  assert.equal(isActionUrl("http://127.0.0.1:4013/settings/profile"), true);
  assert.equal(isActionUrl("http://127.0.0.1:4013/api/billing/portal"), true);
  assert.equal(isActionUrl("http://127.0.0.1:4013/api/notes/u_alice"), false);
  assert.equal(isActionUrl("http://127.0.0.1:4013/admin"), false);
});
