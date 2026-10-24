import assert from "node:assert/strict";
import test from "node:test";
import { buildCustomerReport } from "./report";
import { containsToolBrand, redactSecrets, sanitizeCustomerText } from "./sanitize";
import { TOOL_BRANDS } from "./tool-denylist";

test("sanitizer removes every scanner brand from customer text", () => {
  for (const brand of TOOL_BRANDS) {
    const input = `Found by ${brand} during the crawl.`;
    const output = sanitizeCustomerText(input);
    assert.equal(containsToolBrand(output), null, brand);
    assert.equal(output.toLowerCase().includes(brand.toLowerCase()), false, brand);
  }
});

test("sanitizer redacts live-looking secrets", () => {
  const output = redactSecrets("key sk_live_abcDEF123456 and sk-proj-abcdefghijklmnop");
  assert.equal(output.includes("sk_live_abcDEF123456"), false);
  assert.equal(output.includes("sk-proj-abcdefghijklmnop"), false);
  assert.match(output, /redacted/);
});

test("customer report JSON drops injected tool names and raw engine notes", () => {
  const report = buildCustomerReport({
    scanId: "s1",
    status: "completed",
    mode: "full",
    access: "full",
    finishedAt: new Date("2026-10-01T00:00:00.000Z"),
    now: new Date("2026-10-02T00:00:00.000Z"),
    marked: { secret_in_client: "ok", missing_csp: "ok" },
    results: [
      {
        checkId: "secret_in_client",
        evidence: "trufflehog and nuclei and playwright reported a service-role key sk_test_supersecretvalue000",
      },
      {
        checkId: "missing_csp",
        evidence: "Detected with owasp zap and semgrep.",
      },
    ],
  });
  const blob = JSON.stringify(report);
  assert.equal(containsToolBrand(blob), null);
  assert.equal(blob.includes("sk_test_supersecretvalue000"), false);
  assert.equal(blob.includes("\"raw\""), false);
  assert.equal(blob.includes("engine"), false);
  assert.ok(report.families.some((group) => group.family === "secrets"));
  assert.ok(report.families.some((group) => group.family === "transport_headers"));
});
