import assert from "node:assert/strict";
import test from "node:test";
import { CHECK_CATALOG } from "./catalog";
import { buildDemoReport } from "./demo-report";
import { FREE_PREVIEW_LABEL, buildCoverage, buildCustomerReport, freePreviewFacts, freePreviewLines } from "./report";
import { containsToolBrand } from "./sanitize";

test("demo report groups families, orders headline ranks, and hides tool brands", () => {
  const report = buildDemoReport();
  assert.equal(report.access, "full");
  assert.equal(report.coverage.length, 8);
  assert.ok(report.coverage.every((row) => row.checksNotRun.length === 0));
  assert.ok(report.score !== null && report.score >= 0 && report.score <= 100);
  const seen: number[] = [];
  for (const finding of report.priority) {
    if (finding.headlineRank && seen.at(-1) !== finding.headlineRank) seen.push(finding.headlineRank);
  }
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(containsToolBrand(JSON.stringify(report)), null);
  assert.match(report.disclaimer, /point in time/i);
  assert.doesNotMatch(report.disclaimer, /guarantee of security that lasts/i);
});

test("free teaser keeps the lowest-severity finding and drops the rest of the evidence", () => {
  const marked = Object.fromEntries(CHECK_CATALOG.map((check) => [check.id, "ok" as const]));
  const hidden = "HIDDEN_EVIDENCE_TOKEN_should_not_leak";
  const shown = "LOW_FINDING_EVIDENCE_is_visible";
  const report = buildCustomerReport({
    scanId: "teaser",
    status: "completed",
    mode: "full",
    access: "teaser",
    finishedAt: new Date("2026-10-20T00:00:00.000Z"),
    now: new Date("2026-10-24T00:00:00.000Z"),
    marked,
    results: [
      { checkId: "supabase_rls_disabled", evidence: "sample one evidence" },
      { checkId: "secret_in_client", evidence: hidden },
      { checkId: "missing_referrer_policy", evidence: shown },
    ],
  });
  const blob = JSON.stringify(report);
  assert.equal(report.samples.length, 1);
  assert.equal(report.samples[0]?.checkId, "missing_referrer_policy");
  assert.equal(report.samples[0]?.severity, "low");
  assert.equal(report.hiddenCount, 2);
  assert.equal(report.totalFindings, 3);
  assert.equal(report.severityCounts.critical, 2);
  assert.equal(report.severityCounts.low, 1);
  assert.equal(report.families.length, 0);
  assert.equal(report.priority.length, 0);
  assert.equal(blob.includes(hidden), false);
  assert.equal(blob.includes(shown), true);
  assert.equal(blob.includes("sample one evidence"), false);
  assert.ok(report.coverage.find((row) => row.family === "secrets"));
});

test("paid findings keep location and proof, and the teaser drops them", () => {
  const marked = Object.fromEntries(CHECK_CATALOG.map((check) => [check.id, "ok" as const]));
  const secret = "sk_test_demo_not_real_000000000000000";
  const bundle = "http://127.0.0.1:4010/assets/app.js";
  const firebase = "http://127.0.0.1:4010/rtdb/.json";
  const results = [
    {
      checkId: "secret_in_client",
      evidence: "Public JavaScript included a Stripe secret key.",
      locations: [{ method: "GET", url: bundle, line: 6, column: 36, maskedSecret: "sk_t…0000" }],
      proof: {
        method: "GET",
        url: bundle,
        headers: [
          { name: "authorization", value: `Bearer ${secret}` },
          { name: "accept", value: "*/*" },
        ],
        status: 200,
        responseSnippet: `HTTP 200\n\nconst key = "${secret}"`,
      },
      steps: [`Open ${bundle} at line 6.`, `The credential is shown as sk_t…0000.`],
    },
    {
      checkId: "firebase_rules_open",
      evidence: "The database URL returned JSON without a user credential.",
      locations: [{ method: "GET", url: firebase }],
      proof: {
        method: "GET",
        url: firebase,
        headers: [{ name: "accept", value: "*/*" }],
        status: 200,
        responseSnippet: 'HTTP 200\n\n{"users":{"1":{"email":"ada@example.com"}}}',
      },
      steps: [`Send GET ${firebase} with no session cookie.`, "The body is JSON."],
    },
  ];
  const input = {
    scanId: "where",
    status: "completed",
    mode: "full" as const,
    finishedAt: new Date("2026-10-24T00:00:00.000Z"),
    marked,
    results,
  };
  const paid = buildCustomerReport({ ...input, access: "full" });
  const leaked = paid.priority.find((finding) => finding.checkId === "secret_in_client");
  const openDb = paid.priority.find((finding) => finding.checkId === "firebase_rules_open");
  assert.ok(leaked?.locations?.[0].url === bundle);
  assert.equal(leaked?.locations?.[0].line, 6);
  assert.equal(leaked?.locations?.[0].maskedSecret, "sk_t…0000");
  assert.equal(leaked?.proof?.headers.find((header) => header.name === "authorization")?.value, "[redacted]");
  assert.equal(leaked?.proof?.responseSnippet.includes(secret), false);
  assert.ok((leaked?.proof?.responseSnippet.length ?? 0) <= 300);
  assert.equal(leaked?.steps?.length, 2);
  assert.match(leaked?.fix ?? "", /rotate/i);
  assert.match(openDb?.fix ?? "", /\.read/);
  assert.equal(openDb?.proof?.responseSnippet.includes("ada@example.com"), false);
  assert.equal(openDb?.locations?.[0].url, firebase);

  const teaser = buildCustomerReport({ ...input, access: "teaser" });
  const blob = JSON.stringify(teaser);
  assert.equal(teaser.samples.length, 1);
  assert.equal(teaser.samples[0]?.checkId, "firebase_rules_open");
  assert.equal(teaser.samples[0]?.severity, "critical");
  assert.equal(teaser.hiddenCount, 1);
  assert.equal(teaser.totalFindings, 2);
  assert.equal(teaser.severityCounts.critical, 2);
  assert.equal(blob.includes(bundle), false);
  assert.equal(blob.includes(secret), false);
  assert.equal(blob.includes("sk_t…0000"), false);
  assert.equal(blob.includes(firebase), true);
  assert.equal(teaser.samples[0]?.locations?.[0].url, firebase);
  assert.ok(teaser.samples[0]?.proof);
  assert.equal(blob.includes("ada@example.com"), false);
  assert.ok(teaser.samples.every((finding) => finding.title && finding.severity));
  assert.equal(containsToolBrand(JSON.stringify(paid)), null);
  assert.equal(containsToolBrand(blob), null);
});

test("free preview counts only checks and findings that are on the report", () => {
  assert.equal(FREE_PREVIEW_LABEL, "Free preview");
  const marked = { missing_csp: "ok" as const, exposed_dotenv: "ok" as const };
  const report = buildCustomerReport({
    scanId: "mini",
    status: "completed",
    mode: "mini",
    access: "full",
    finishedAt: new Date("2026-10-24T00:00:00.000Z"),
    marked,
    results: [{ checkId: "exposed_dotenv", evidence: "env file was public" }],
  });
  const facts = freePreviewFacts(report);
  assert.equal(facts.findingsShown, 1);
  assert.equal(facts.checksRun, 2);
  assert.equal(facts.checksNotRun, CHECK_CATALOG.length - 2);
  assert.equal(facts.hiddenFindings, 0);
  assert.ok(facts.familiesNotRun.includes("Access control"));
  const lines = freePreviewLines(facts);
  assert.equal(lines.some((line) => /more finding/i.test(line)), false);
  assert.match(lines.join("\n"), new RegExp(`After purchase, the full report runs all ${CHECK_CATALOG.length} checks on this origin`));
  assert.match(lines.join("\n"), new RegExp(`${CHECK_CATALOG.length - 2} checks that did not run`));
  assert.equal(containsToolBrand(lines.join("\n")), null);

  const teaser = buildCustomerReport({
    scanId: "mini-teaser",
    status: "completed",
    mode: "mini",
    access: "teaser",
    finishedAt: new Date("2026-10-24T00:00:00.000Z"),
    marked: Object.fromEntries(CHECK_CATALOG.map((check) => [check.id, "ok" as const])),
    results: [
      { checkId: "supabase_rls_disabled", evidence: "one" },
      { checkId: "secret_in_client", evidence: "two" },
      { checkId: "missing_csp", evidence: "three" },
    ],
  });
  const hidden = freePreviewFacts(teaser);
  assert.equal(hidden.findingsShown, 1);
  assert.equal(hidden.hiddenFindings, 2);
  assert.equal(hidden.checksNotRun, 0);
  const hiddenLines = freePreviewLines(hidden);
  assert.match(hiddenLines.join("\n"), /2 findings from checks that already ran are in the full report/);
  assert.equal(hiddenLines.some((line) => /did not run/.test(line)), false);
});

test("coverage marks families that were not executed", () => {
  const coverage = buildCoverage({ missing_csp: "ok", exposed_dotenv: "ok" }, ["exposed_dotenv"]);
  assert.equal(coverage.find((row) => row.family === "access_control")?.status, "not_run");
  assert.equal(coverage.find((row) => row.family === "info_disclosure")?.status, "findings");
  assert.equal(coverage.find((row) => row.family === "transport_headers")?.status, "incomplete");
});
