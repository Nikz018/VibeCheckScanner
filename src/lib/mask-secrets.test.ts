import assert from "node:assert/strict";
import test from "node:test";
import { scrubCredentialText, scrubKnownSecrets, stripSensitiveQuery } from "./mask-secrets";
import { ScanContext } from "../worker/context";

test("known passwords, cookies, and bearer tokens are masked", () => {
  const password = "test-password-alice";
  const cookie = "session=abcdef1234567890";
  const token = "eyJhbGciOiJub25lIn0.eyJyb2xlIjoidXNlciJ9.none";
  const input = `login ${password} cookie ${cookie} Authorization: Bearer ${token} url https://app.example/a?password=${password}&ok=1`;
  const masked = scrubCredentialText(input, [password, cookie, token]);
  assert.equal(masked.includes(password), false);
  assert.equal(masked.includes("abcdef1234567890"), false);
  assert.equal(masked.includes(token), false);
  assert.match(masked, /Bearer \[redacted\]/);
  assert.match(masked, /password=redacted/);
  assert.equal(scrubKnownSecrets("keep short", ["short"]).includes("short"), true);
  assert.equal(stripSensitiveQuery("https://app.example/notes?token=abc&id=u_alice"), "https://app.example/notes?token=redacted&id=u_alice");
});

test("findings stored on a scan drop the test-account secret", () => {
  const ctx = new ScanContext("http://127.0.0.1:4013/", "full");
  const password = "test-password-alice";
  ctx.rememberSecret(password);
  ctx.add(
    "auth_session_weakness",
    `The password ${password} was not stored.`,
    {
      locations: [{ method: "GET", url: `http://127.0.0.1:4013/app?token=${password}` }],
      proof: {
        method: "GET",
        url: "http://127.0.0.1:4013/app",
        headers: [{ name: "cookie", value: `session=${password}` }],
        status: 200,
        responseSnippet: password,
      },
      steps: [`Do not repeat ${password}.`],
    },
    "high",
  );
  const blob = JSON.stringify(ctx.results);
  assert.equal(blob.includes(password), false);
  assert.equal(ctx.results[0].confidence, "high");
});
