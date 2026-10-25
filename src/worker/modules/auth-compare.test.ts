import assert from "node:assert/strict";
import test from "node:test";
import {
  crossAccountLeak,
  inspectCookieFlags,
  inspectJwt,
  isObjectFetch,
  isPrivilegedResponse,
  otherUserEmails,
  paywallBypass,
  swapUrlId,
  swappedIdLeak,
} from "./auth-compare";

const alice = JSON.stringify({ id: "u_alice", email: "alice@example.test", note: "alice-private-note-alpha" });
const bob = JSON.stringify({ id: "u_bob", email: "bob@example.test", note: "bob-private-note-bravo" });

test("cross-account comparison flags another user's object and ignores a different record", () => {
  const leaked = crossAccountLeak({ ownerBody: alice, replayStatus: 200, replayBody: alice });
  assert.equal(leaked.leak, true);
  assert.ok(leaked.markers.includes("alice@example.test"));
  assert.equal(crossAccountLeak({ ownerBody: alice, replayStatus: 200, replayBody: bob }).leak, false);
  assert.equal(crossAccountLeak({ ownerBody: alice, replayStatus: 401, replayBody: alice }).leak, false);
  assert.equal(crossAccountLeak({ ownerBody: "<!doctype html><p>home</p>", replayStatus: 200, replayBody: "<!doctype html><p>home</p>" }).leak, false);
});

test("id swap detects the other account's id in a read-only response", () => {
  const swapped = swapUrlId("http://127.0.0.1:4013/api/notes/u_alice", "u_alice", "u_bob");
  assert.equal(swapped, "http://127.0.0.1:4013/api/notes/u_bob");
  assert.equal(swapUrlId("http://127.0.0.1:4013/api/me", "u_alice", "u_bob"), null);
  const leak = swappedIdLeak({
    status: 200,
    body: bob,
    foreignMarkers: ["u_bob", "bob@example.test", "bob-private-note-bravo"],
    ownMarkers: ["u_alice", "alice@example.test"],
  });
  assert.equal(leak.leak, true);
  assert.equal(isObjectFetch("http://127.0.0.1:4013/api/notes/u_alice", alice), true);
  assert.equal(isObjectFetch("http://127.0.0.1:4013/api/admin/users", JSON.stringify([{ id: "u_alice" }, { id: "u_bob" }])), false);
});

test("admin, paywall, cookie, and token heuristics stay read-only judgments", () => {
  assert.equal(isPrivilegedResponse("http://127.0.0.1:4013/admin", 200, `<div data-admin-panel="true"></div>`), true);
  assert.equal(isPrivilegedResponse("http://127.0.0.1:4013/login", 200, `<input type="password" /><p>Log in</p>`), false);
  assert.deepEqual(paywallBypass({ plan: "free", status: 200, body: JSON.stringify({ access: "premium", lesson: "paid lesson body" }) }), {
    bypass: true,
    confidence: "high",
  });
  assert.equal(paywallBypass({ plan: "premium", status: 200, body: JSON.stringify({ access: "premium", lesson: "paid lesson body" }) }).bypass, false);
  const cookie = inspectCookieFlags("session=abc; HttpOnly; Path=/");
  assert.deepEqual(cookie?.missing, ["Secure", "SameSite"]);
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ email: "alice@example.test", api_key: "embedded-demo-claim" })).toString("base64url");
  const jwt = inspectJwt(`${header}.${payload}.none`);
  assert.equal(jwt?.algNone, true);
  assert.equal(jwt?.missingExp, true);
  assert.deepEqual(jwt?.sensitiveClaims, ["api_key"]);
  assert.deepEqual(otherUserEmails(JSON.stringify([{ email: "alice@example.test" }, { email: "carol@example.test" }]), ["alice@example.test"]), [
    "carol@example.test",
  ]);
});
