import assert from "node:assert/strict";
import test from "node:test";
import { CHECK_CATALOG } from "./catalog";
import { downloadAccess, downloadBasename, renderFixMarkdown, renderPrintHtml } from "./download";
import { scrubPdfToolMetadata } from "./render-pdf";
import { buildCustomerReport } from "./report";
import { containsToolBrand } from "./sanitize";

const secret = "sk_test_demo_not_real_000000000000000";
const bundle = "http://127.0.0.1:4010/assets/app.js";

function paidReport() {
  const marked = Object.fromEntries(CHECK_CATALOG.map((check) => [check.id, "ok" as const]));
  return buildCustomerReport({
    scanId: "scan-1",
    status: "completed",
    mode: "full",
    access: "full",
    finishedAt: new Date("2026-10-25T03:00:00.000Z"),
    marked,
    results: [
      {
        checkId: "secret_in_client",
        evidence: "nuclei found a Stripe secret key in the bundle.",
        locations: [{ method: "GET", url: bundle, line: 6, column: 36, maskedSecret: "sk_t…0000" }],
        proof: {
          method: "GET",
          url: bundle,
          headers: [{ name: "authorization", value: `Bearer ${secret}` }],
          status: 200,
          responseSnippet: `const key = "${secret}"; email ada@example.com`,
        },
        steps: [`Open ${bundle} at line 6.`],
      },
      {
        checkId: "firebase_rules_open",
        evidence: "The database returned JSON.",
        locations: [{ method: "GET", url: "http://127.0.0.1:4010/rtdb/.json" }],
        proof: {
          method: "GET",
          url: "http://127.0.0.1:4010/rtdb/.json",
          headers: [{ name: "accept", value: "application/json" }],
          status: 200,
          responseSnippet: '{"email":"ada@example.com"}',
        },
        steps: ["Send GET http://127.0.0.1:4010/rtdb/.json with no session cookie."],
      },
    ],
  });
}

test("download names use the host and scan day", () => {
  assert.equal(downloadBasename("http://127.0.0.1:4010/app", new Date("2026-10-25T18:00:00.000Z")), "vibecheck-127.0.0.1-4010-2026-10-25");
});

test("downloads require the owner and a paid completed scan", () => {
  assert.deepEqual(downloadAccess({ userId: null, scan: null }), { ok: false, status: 401 });
  assert.deepEqual(downloadAccess({ userId: "user-a", scan: null }), { ok: false, status: 404 });
  assert.deepEqual(
    downloadAccess({ userId: "user-b", scan: { userId: "user-a", reportAccess: "full", status: "completed" } }),
    { ok: false, status: 403 },
  );
  assert.deepEqual(
    downloadAccess({ userId: "user-a", scan: { userId: "user-a", reportAccess: "teaser", status: "completed" } }),
    { ok: false, status: 403 },
  );
  assert.deepEqual(
    downloadAccess({ userId: "user-a", scan: { userId: "user-a", reportAccess: "full", status: "running" } }),
    { ok: false, status: 403 },
  );
  assert.deepEqual(
    downloadAccess({ userId: "user-a", scan: { userId: "user-a", reportAccess: "full", status: "completed" } }),
    { ok: true },
  );
});

test("markdown and print html keep location and fix, and drop raw secrets and tool names", () => {
  const report = paidReport();
  const markdown = renderFixMarkdown(report, "http://127.0.0.1:4010");
  const html = renderPrintHtml(report, "http://127.0.0.1:4010");
  for (const body of [markdown, html]) {
    assert.match(body, /127\.0\.0\.1:4010\/rtdb\/\.json/);
    assert.match(body, /assets\/app\.js/);
    assert.match(body, /sk_t…0000/);
    assert.match(body, /line 6/);
    assert.equal(body.includes(secret), false);
    assert.equal(body.includes("ada@example.com"), false);
    assert.equal(containsToolBrand(body), null);
    assert.equal(body.toLowerCase().includes("nuclei"), false);
    assert.match(body, /point in time/i);
  }
  assert.match(markdown, /^Fix these security issues in my app\./);
  assert.match(markdown, /### Fix/);
  assert.match(html, /data-report="vibecheck-print"/);
  assert.match(html, /class="finding"/);
  assert.match(html, /VibeCheck score/);
  assert.match(html, /<pre>[^<]*<\/pre>/);
});

test("pdf metadata does not name the browser that printed it", () => {
  const creator = "Mozilla/5.0 \\(X11; Linux x86_64\\) AppleWebKit/537.36 \\(KHTML, like Gecko\\) HeadlessChrome/156.0.0.0 Safari/537.36";
  const raw = Buffer.from(`%PDF-1.4\n1 0 obj\n<</Title (vibecheck)\n/Creator (${creator})\n/Producer (Skia/PDF m156)\n>>\nendobj\n`);
  const scrubbed = scrubPdfToolMetadata(raw);
  assert.equal(scrubbed.length, raw.length);
  const text = scrubbed.toString("latin1");
  assert.equal(text.includes("HeadlessChrome"), false);
  assert.equal(text.includes("Skia"), false);
  assert.equal(text.includes("Mozilla"), false);
  assert.match(text, /\/Creator \(VibeCheck +\)/);
  assert.match(text, /\/Producer \(VibeCheck +\)/);
});
