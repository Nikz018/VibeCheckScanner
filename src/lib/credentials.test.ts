import assert from "node:assert/strict";
import test from "node:test";
import {
  CREDENTIAL_TTL_MS,
  credentialExpiresAt,
  credentialsKey,
  decryptCredentials,
  encryptCredentials,
  shouldDeleteCredential,
} from "./credentials";

const KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

test("credentials round-trip and the ciphertext hides the password", () => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = KEY;
  const payload = { accounts: [{ label: "A", password: "test-password-alice", cookie: "session=super-secret-cookie" }] };
  const first = encryptCredentials(payload);
  const second = encryptCredentials(payload);
  assert.notEqual(first, second);
  assert.equal(first.includes("test-password-alice"), false);
  assert.equal(first.includes("super-secret-cookie"), false);
  assert.deepEqual(decryptCredentials(first), payload);
  assert.equal(credentialsKey().length, 32);
});

test("base64 keys are accepted and a bad key fails closed", () => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = Buffer.from(KEY, "hex").toString("base64");
  const encoded = encryptCredentials({ ok: true });
  assert.deepEqual(decryptCredentials(encoded), { ok: true });

  process.env.CREDENTIALS_ENCRYPTION_KEY = "too-short";
  assert.throws(() => encryptCredentials({ ok: true }), /32 bytes/);
  delete process.env.CREDENTIALS_ENCRYPTION_KEY;
  assert.throws(() => credentialsKey(), /not set/);
  process.env.CREDENTIALS_ENCRYPTION_KEY = KEY;
});

test("tampered ciphertext is rejected", () => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = KEY;
  const encoded = encryptCredentials({ password: "test-password-alice" });
  const buf = Buffer.from(encoded, "base64");
  buf[buf.length - 1] ^= 0xff;
  assert.throws(() => decryptCredentials(buf.toString("base64")), /unreadable/);
});

test("credentials are deleted when the scan finishes or the TTL passes", () => {
  const now = new Date("2026-10-25T12:00:00.000Z");
  const fresh = credentialExpiresAt(now);
  assert.equal(fresh.getTime() - now.getTime(), CREDENTIAL_TTL_MS);
  assert.equal(shouldDeleteCredential({ expiresAt: fresh, scanStatus: "running", now }), false);
  assert.equal(shouldDeleteCredential({ expiresAt: fresh, scanStatus: "completed", now }), true);
  assert.equal(shouldDeleteCredential({ expiresAt: fresh, scanStatus: "failed", now }), true);
  assert.equal(shouldDeleteCredential({ expiresAt: now, scanStatus: "running", now }), true);
  assert.equal(shouldDeleteCredential({ expiresAt: new Date(now.getTime() - 1), scanStatus: "queued", now }), true);
});
