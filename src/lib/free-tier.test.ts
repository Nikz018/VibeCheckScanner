import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { CHECK_CATALOG } from "./catalog";
import { orderedFindings, renderFixMarkdown, renderPrintHtml } from "./download";
import {
  formatSeverityBreakdown,
  isFreeTierDelivery,
  lockedSeverityRows,
  lowestSeverityFinding,
  readSeverityCounts,
  visibleCustomerFindings,
  buildCustomerReport,
  FULL_REPORT_LABEL,
  reportBadge,
  type CustomerFinding,
  type CustomerReport,
} from "./report";
import { ownedScanAccess } from "./entitlements";
import { reportFromStored } from "./stored-report";

const marked = Object.fromEntries(CHECK_CATALOG.map((check) => [check.id, "ok" as const]));

function detail(url: string) {
  return {
    locations: [{ method: "GET", url }],
    proof: {
      method: "GET",
      url,
      headers: [{ name: "accept", value: "*/*" }],
      status: 200,
      responseSnippet: `HTTP 200\n\nseen at ${url}`,
    },
    steps: [`Send GET ${url} with no session cookie.`],
  };
}

function gatedReport() {
  return buildCustomerReport({
    scanId: "free-scan",
    status: "completed",
    mode: "full",
    access: "teaser",
    finishedAt: new Date("2026-10-24T00:00:00.000Z"),
    marked,
    results: [
      { checkId: "supabase_rls_disabled", evidence: "CRITICAL_TABLE_EVIDENCE", ...detail("https://app.example/rest/v1/users") },
      { checkId: "exposed_git", evidence: "HIGH_ADMIN_EVIDENCE", ...detail("https://app.example/admin") },
      { checkId: "missing_csp", evidence: "MEDIUM_CSP_EVIDENCE", ...detail("https://app.example/") },
      { checkId: "missing_referrer_policy", evidence: "LOW_REFERRER_EVIDENCE", ...detail("https://app.example/low") },
      { checkId: "client_backend_config", evidence: "INFO_CONFIG_EVIDENCE", ...detail("https://app.example/config.js") },
    ],
  });
}

function assertWithheld(report: CustomerReport, shownEvidence: string) {
  assert.equal(report.access, "teaser");
  assert.equal(report.samples.length, 1);
  assert.equal(report.families.length, 0);
  assert.equal(report.priority.length, 0);
  assert.equal(visibleCustomerFindings(report).length, 1);
  assert.equal(orderedFindings(report).length, 1);
  const blob = JSON.stringify(report);
  assert.equal(blob.includes(shownEvidence), true);
  for (const hidden of ["CRITICAL_TABLE_EVIDENCE", "HIGH_ADMIN_EVIDENCE", "MEDIUM_CSP_EVIDENCE", "LOW_REFERRER_EVIDENCE"]) {
    if (hidden === shownEvidence) continue;
    assert.equal(blob.includes(hidden), false, hidden);
  }
  for (const hiddenUrl of ["https://app.example/rest/v1/users", "https://app.example/admin", "https://app.example/low"]) {
    assert.equal(blob.includes(hiddenUrl), false, hiddenUrl);
  }
}

test("free tier server output contains exactly the lowest-severity finding and the real counts", () => {
  assert.equal(isFreeTierDelivery({ mode: "full", access: "teaser" }), true);
  assert.equal(isFreeTierDelivery({ mode: "mini", access: "full" }), true);
  assert.equal(isFreeTierDelivery({ mode: "full", access: "full" }), false);

  const report = gatedReport();
  assert.equal(report.samples[0]?.checkId, "client_backend_config");
  assert.equal(report.samples[0]?.severity, "info");
  assert.equal(report.samples[0]?.locations?.[0].url, "https://app.example/config.js");
  assert.equal(report.samples[0]?.proof?.url, "https://app.example/config.js");
  assert.equal(report.samples[0]?.steps?.length, 1);
  assert.match(report.samples[0]?.fix ?? "", /\S/);
  assert.equal(report.hiddenCount, 4);
  assert.equal(report.totalFindings, 5);
  assert.deepEqual(report.severityCounts, { critical: 1, high: 1, medium: 1, low: 1, info: 1 });
  assert.equal(formatSeverityBreakdown(report.severityCounts), "1 Critical, 1 High, 1 Medium, 1 Low, 1 Info");
  assert.deepEqual(lockedSeverityRows(report), ["critical", "high", "medium", "low"]);
  assertWithheld(report, "INFO_CONFIG_EVIDENCE");

  const email = [
    `Findings: ${report.totalFindings}`,
    formatSeverityBreakdown(report.severityCounts),
    ...visibleCustomerFindings(report).flatMap((finding) => [finding.title, finding.evidence, finding.proof?.url ?? ""]),
  ].join("\n");
  assert.match(email, /INFO_CONFIG_EVIDENCE/);
  assert.doesNotMatch(email, /CRITICAL_TABLE_EVIDENCE|HIGH_ADMIN_EVIDENCE|MEDIUM_CSP_EVIDENCE|LOW_REFERRER_EVIDENCE/);
  assert.match(email, /1 Critical, 1 High, 1 Medium, 1 Low, 1 Info/);

  const markdown = renderFixMarkdown(report, "https://app.example");
  const html = renderPrintHtml(report, "https://app.example");
  for (const body of [markdown, html]) {
    assert.match(body, /Backend client configuration is embedded in the bundle/);
    assert.match(body, /https:\/\/app\.example\/config\.js/);
    assert.doesNotMatch(body, /CRITICAL_TABLE_EVIDENCE|HIGH_ADMIN_EVIDENCE|MEDIUM_CSP_EVIDENCE|LOW_REFERRER_EVIDENCE/);
    assert.doesNotMatch(body, /rest\/v1\/users|\/admin|\/low/);
  }
  assert.match(markdown, /1 Critical, 1 High, 1 Medium, 1 Low, 1 Info/);
  assert.match(html, /<strong>1<\/strong><span>critical<\/span>/);
  assert.match(html, /<strong>1<\/strong><span>info<\/span>/);
});

test("a mini preview stored as full access still withholds every finding except the lowest severity", () => {
  const stored = reportFromStored({
    scanId: "mini-free",
    status: "completed",
    mode: "mini",
    reportAccess: "full",
    finishedAt: new Date("2026-10-24T00:00:00.000Z"),
    coverage: { marked },
    findings: [
      {
        checkId: "missing_csp",
        evidence: "MEDIUM_CSP_EVIDENCE",
        severity: "medium",
        title: "Content-Security-Policy header is missing",
        impact: "medium impact",
        fix: "medium fix",
        raw: detail("https://app.example/medium-only"),
      },
      {
        checkId: "missing_referrer_policy",
        evidence: "LOW_REFERRER_EVIDENCE",
        severity: "low",
        title: "Referrer-Policy is missing",
        impact: "low impact",
        fix: "low fix",
        raw: detail("https://app.example/low"),
      },
    ],
  });
  assert.equal(stored.mode, "mini");
  assert.equal(stored.access, "teaser");
  assert.equal(stored.samples.length, 1);
  assert.equal(stored.samples[0]?.severity, "low");
  assert.equal(stored.samples[0]?.evidence, "LOW_REFERRER_EVIDENCE");
  assert.equal(stored.samples[0]?.locations?.[0].url, "https://app.example/low");
  assert.equal(stored.hiddenCount, 1);
  assert.equal(stored.totalFindings, 2);
  assert.equal(stored.severityCounts.medium, 1);
  assert.equal(stored.severityCounts.low, 1);
  const blob = JSON.stringify(stored);
  assert.equal(blob.includes("MEDIUM_CSP_EVIDENCE"), false);
  assert.equal(blob.includes("https://app.example/medium-only"), false);
});

test("paid full reports and active unlocked scans still include every finding", () => {
  const paid = buildCustomerReport({
    scanId: "paid",
    status: "completed",
    mode: "full",
    access: "full",
    finishedAt: new Date("2026-10-24T00:00:00.000Z"),
    marked,
    results: [
      { checkId: "supabase_rls_disabled", evidence: "CRITICAL_TABLE_EVIDENCE", ...detail("https://app.example/rest/v1/users") },
      { checkId: "missing_referrer_policy", evidence: "LOW_REFERRER_EVIDENCE", ...detail("https://app.example/low") },
    ],
  });
  assert.equal(paid.access, "full");
  assert.equal(paid.hiddenCount, 0);
  assert.equal(visibleCustomerFindings(paid).length, 2);
  assert.equal(lockedSeverityRows(paid).length, 0);
  const blob = JSON.stringify(paid);
  assert.equal(blob.includes("CRITICAL_TABLE_EVIDENCE"), true);
  assert.equal(blob.includes("LOW_REFERRER_EVIDENCE"), true);
  assert.equal(blob.includes("https://app.example/rest/v1/users"), true);
});

test("a scan with zero findings says so and does not invent a sample", () => {
  const report = buildCustomerReport({
    scanId: "empty",
    status: "completed",
    mode: "mini",
    access: "full",
    finishedAt: new Date("2026-10-24T00:00:00.000Z"),
    marked,
    results: [],
  });
  assert.equal(report.totalFindings, 0);
  assert.equal(report.hiddenCount, 0);
  assert.equal(report.samples.length, 0);
  assert.equal(lowestSeverityFinding([]), null);
  assert.deepEqual(lockedSeverityRows(report), []);
  assert.equal(formatSeverityBreakdown(report.severityCounts), "");
  assert.equal(JSON.stringify(report).includes("Locked finding"), false);
});

test("equal severities pick one finding by title, and counts stay complete", () => {
  const report = buildCustomerReport({
    scanId: "tie",
    status: "completed",
    mode: "full",
    access: "teaser",
    finishedAt: new Date("2026-10-24T00:00:00.000Z"),
    marked,
    results: [
      { checkId: "missing_csp", evidence: "MEDIUM_CSP_EVIDENCE" },
      { checkId: "missing_hsts", evidence: "MEDIUM_HSTS_EVIDENCE" },
    ],
  });
  assert.equal(report.samples.length, 1);
  assert.equal(report.samples[0]?.severity, "medium");
  const titles = ["Content-Security-Policy header is missing", "Strict-Transport-Security header is missing"].sort((a, b) => a.localeCompare(b));
  assert.equal(report.samples[0]?.title, titles[0]);
  assert.equal(report.severityCounts.medium, 2);
  assert.equal(report.hiddenCount, 1);
  assert.equal(formatSeverityBreakdown(report.severityCounts), "2 Medium");
  const shown = report.samples[0] as CustomerFinding;
  const withheld = shown.title.startsWith("Content-Security") ? "MEDIUM_HSTS_EVIDENCE" : "MEDIUM_CSP_EVIDENCE";
  assert.equal(JSON.stringify(report).includes(withheld), false);
});

test("dashboard count parser and customer APIs do not describe hidden finding bodies", () => {
  assert.equal(readSeverityCounts(null), null);
  assert.deepEqual(readSeverityCounts({ critical: 2, high: 3, medium: 5, low: 1, info: 0 }), {
    critical: 2,
    high: 3,
    medium: 5,
    low: 1,
    info: 0,
  });
  assert.equal(formatSeverityBreakdown({ critical: 2, high: 3, medium: 5, low: 1, info: 0 }), "2 Critical, 3 High, 5 Medium, 1 Low");

  const root = process.cwd();
  const read = (file: string) => readFileSync(path.join(root, file), "utf8");
  const statusRoute = read("src/app/api/scans/[id]/route.ts");
  assert.doesNotMatch(statusRoute, /findings/);
  const execute = read("src/worker/execute.ts");
  const alerts = execute.slice(execute.indexOf("async function maybeAlert"));
  assert.doesNotMatch(alerts, /finding\.(title|evidence|impact|fix|locations|proof)/);
  const dashboard = read("src/app/dashboard/page.tsx");
  assert.doesNotMatch(dashboard, /include:\s*\{\s*findings/);
});

test("subscriber gating returns every finding on a free or mini scan and clears upsell", () => {
  assert.deepEqual(ownedScanAccess({ mode: "mini", reportAccess: "full", subscriber: true, purchased: false }), {
    unlock: true,
    upsell: false,
  });
  assert.deepEqual(ownedScanAccess({ mode: "full", reportAccess: "teaser", subscriber: true, purchased: false }), {
    unlock: true,
    upsell: false,
  });
  assert.deepEqual(ownedScanAccess({ mode: "mini", reportAccess: "teaser", subscriber: false, purchased: true }), {
    unlock: true,
    upsell: false,
  });
  assert.deepEqual(ownedScanAccess({ mode: "mini", reportAccess: "full", subscriber: false, purchased: false }), {
    unlock: false,
    upsell: true,
  });
  assert.deepEqual(ownedScanAccess({ mode: "full", reportAccess: "full", subscriber: false, purchased: false }), {
    unlock: false,
    upsell: false,
  });

  for (const mode of ["mini", "full"] as const) {
    const report = buildCustomerReport({
      scanId: `subscriber-${mode}`,
      status: "completed",
      mode,
      access: "teaser",
      unlock: true,
      finishedAt: new Date("2026-10-24T00:00:00.000Z"),
      marked,
      results: [
        { checkId: "supabase_rls_disabled", evidence: "CRITICAL_TABLE_EVIDENCE", ...detail("https://app.example/rest/v1/users") },
        { checkId: "exposed_git", evidence: "HIGH_ADMIN_EVIDENCE", ...detail("https://app.example/admin") },
        { checkId: "missing_csp", evidence: "MEDIUM_CSP_EVIDENCE", ...detail("https://app.example/") },
        { checkId: "missing_referrer_policy", evidence: "LOW_REFERRER_EVIDENCE", ...detail("https://app.example/low") },
        { checkId: "client_backend_config", evidence: "INFO_CONFIG_EVIDENCE", ...detail("https://app.example/config.js") },
      ],
    });
    assert.equal(report.upsell, false);
    assert.equal(report.access, "full");
    assert.equal(report.hiddenCount, 0);
    assert.equal(report.totalFindings, 5);
    assert.equal(visibleCustomerFindings(report).length, 5);
    assert.equal(lockedSeverityRows(report).length, 0);
    assert.equal(reportBadge(report), FULL_REPORT_LABEL);
    const blob = JSON.stringify(report);
    for (const evidence of ["CRITICAL_TABLE_EVIDENCE", "HIGH_ADMIN_EVIDENCE", "MEDIUM_CSP_EVIDENCE", "LOW_REFERRER_EVIDENCE", "INFO_CONFIG_EVIDENCE"]) {
      assert.equal(blob.includes(evidence), true, evidence);
    }
    const markdown = renderFixMarkdown(report, "https://app.example");
    const html = renderPrintHtml(report, "https://app.example");
    for (const body of [markdown, html]) {
      assert.match(body, /https:\/\/app\.example\/rest\/v1\/users/);
      assert.match(body, /https:\/\/app\.example\/config\.js/);
      assert.match(body, /Supabase table is readable/);
      assert.doesNotMatch(body, /\$49|\$99|\$29|Upgrade to|What the full report adds|Free preview/);
    }
  }

  const stored = reportFromStored({
    scanId: "subscriber-stored-mini",
    status: "completed",
    mode: "mini",
    reportAccess: "teaser",
    finishedAt: new Date("2026-10-24T00:00:00.000Z"),
    unlock: true,
    coverage: { marked, pagesScanned: 5 },
    findings: [
      {
        checkId: "missing_csp",
        evidence: "MEDIUM_CSP_EVIDENCE",
        severity: "medium",
        title: "Content-Security-Policy header is missing",
        impact: "medium impact",
        fix: "medium fix",
        raw: detail("https://app.example/medium-only"),
      },
      {
        checkId: "missing_referrer_policy",
        evidence: "LOW_REFERRER_EVIDENCE",
        severity: "low",
        title: "Referrer-Policy is missing",
        impact: "low impact",
        fix: "low fix",
        raw: detail("https://app.example/low"),
      },
    ],
  });
  assert.equal(stored.upsell, false);
  assert.equal(stored.pagesScanned, 5);
  assert.equal(visibleCustomerFindings(stored).length, 2);
  assert.equal(JSON.stringify(stored).includes("MEDIUM_CSP_EVIDENCE"), true);
  assert.equal(JSON.stringify(stored).includes("https://app.example/medium-only"), true);
});
