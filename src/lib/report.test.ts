import assert from "node:assert/strict";
import test from "node:test";
import { CHECK_CATALOG } from "./catalog";
import { buildDemoReport } from "./demo-report";
import { buildCoverage, buildCustomerReport } from "./report";
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

test("free teaser keeps two samples and drops the rest of the evidence", () => {
  const marked = Object.fromEntries(CHECK_CATALOG.map((check) => [check.id, "ok" as const]));
  const hidden = "HIDDEN_EVIDENCE_TOKEN_should_not_leak";
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
      { checkId: "secret_in_client", evidence: "sample two evidence" },
      { checkId: "missing_referrer_policy", evidence: hidden },
    ],
  });
  const blob = JSON.stringify(report);
  assert.equal(report.samples.length, 2);
  assert.equal(report.hiddenCount, 1);
  assert.equal(report.families.length, 0);
  assert.equal(report.priority.length, 0);
  assert.equal(blob.includes(hidden), false);
  assert.equal(report.severityCounts.critical >= 1, true);
  assert.ok(report.coverage.find((row) => row.family === "secrets"));
});

test("coverage marks families that were not executed", () => {
  const coverage = buildCoverage({ missing_csp: "ok", exposed_dotenv: "ok" }, ["exposed_dotenv"]);
  assert.equal(coverage.find((row) => row.family === "access_control")?.status, "not_run");
  assert.equal(coverage.find((row) => row.family === "info_disclosure")?.status, "findings");
  assert.equal(coverage.find((row) => row.family === "transport_headers")?.status, "incomplete");
});
