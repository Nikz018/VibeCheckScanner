import assert from "node:assert/strict";
import test from "node:test";
import { buildProof, maskSecret, redactHeaderValue, responseSnippet } from "./finding-detail";

test("secrets are masked to the first and last four characters", () => {
  assert.equal(maskSecret("sk_test_demo_not_real_000000000000000"), "sk_t…0000");
  assert.equal(maskSecret("short"), "••••");
  const pem = "-----BEGIN PRIVATE KEY-----\nMIIBshortkeymaterialENDING\n-----END PRIVATE KEY-----";
  assert.equal(maskSecret(pem).includes("BEGIN"), false);
  assert.match(maskSecret(pem), /^.{4}….{4}$/);
});

test("request headers and response snippets redact credentials and emails", () => {
  assert.equal(redactHeaderValue("authorization", "Bearer sk_test_demo_not_real_000000000000000"), "[redacted]");
  assert.equal(redactHeaderValue("apikey", "eyJhbGciOiJub25lIn0.eyJyb2xlIjoiYW5vbiJ9.demo"), "[redacted]");
  assert.match(redactHeaderValue("set-cookie", "session=supersecret; Path=/"), /^session=\[redacted\]/);
  const snippet = responseSnippet({
    status: 200,
    headers: { "content-type": "application/json" },
    body: '{"email":"ada@example.com","key":"sk_test_demo_not_real_000000000000000"}',
  });
  assert.ok(snippet.length <= 300);
  assert.equal(snippet.includes("ada@example.com"), false);
  assert.equal(snippet.includes("sk_test_demo_not_real_000000000000000"), false);
  assert.match(snippet, /HTTP 200/);
});

test("proof records the method and url with redacted headers", () => {
  const proof = buildProof({
    method: "get",
    url: "http://127.0.0.1:4010/rtdb/.json",
    requestHeaders: { authorization: "Bearer secret", accept: "application/json" },
    response: { status: 200, headers: { "content-type": "application/json" }, body: "{\"users\":1}" },
  });
  assert.equal(proof.method, "GET");
  assert.equal(proof.url, "http://127.0.0.1:4010/rtdb/.json");
  assert.equal(proof.headers.find((header) => header.name === "authorization")?.value, "[redacted]");
  assert.equal(proof.headers.find((header) => header.name === "accept")?.value, "application/json");
  assert.ok(proof.responseSnippet.length <= 300);
});
