import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { CHECK_CATALOG } from "./catalog";
import type { CodeFinding } from "./code-scan/types";
import { orderedListedFindings, renderFixMarkdown, renderPrintHtml } from "./download";
import {
  FREE_PREVIEW_BLUR_CAP,
  blurredSeverityLabels,
  clientScanReport,
  listPaidFindings,
  lockedFindingsSummary,
  lockedSeverityCounts,
} from "./finding-order";
import { buildCustomerReport, visibleCustomerFindings } from "./report";
import { containsToolBrand } from "./sanitize";
import { publicScanStatus } from "./scan-status";

const marked = Object.fromEntries(CHECK_CATALOG.map((check) => [check.id, "ok" as const]));

function codeFinding(input: Partial<CodeFinding> & Pick<CodeFinding, "ruleId" | "severity" | "title">): CodeFinding {
  return {
    family: "Secrets",
    file: "src/app.ts",
    line: 4,
    snippet: "const value = \"[redacted]\";",
    explanation: `${input.title} explanation`,
    owasp: "A02:2021",
    fixPrompt: `Fix ${input.title}`,
    ...input,
  };
}

test("site and code findings sort by severity, then confidence, then title", () => {
  const report = buildCustomerReport({
    scanId: "sorted",
    status: "completed",
    mode: "full",
    access: "full",
    finishedAt: new Date("2026-11-01T00:00:00.000Z"),
    marked,
    unlock: true,
    results: [
      { checkId: "missing_csp", severity: "medium", title: "Site medium", confidence: "high", evidence: "site medium evidence" },
      { checkId: "missing_referrer_policy", severity: "low", title: "Site low", evidence: "site low evidence" },
      { checkId: "client_backend_config", severity: "info", title: "Site info", evidence: "site info evidence" },
      { checkId: "exposed_git", severity: "critical", title: "Site critical late", confidence: "low", evidence: "site critical late evidence" },
      { checkId: "supabase_rls_disabled", severity: "critical", title: "Site critical early", confidence: "high", evidence: "site critical early evidence" },
      { checkId: "admin_surface_open", severity: "high", title: "Site high", evidence: "site high evidence" },
    ],
  });
  const code = [
    codeFinding({ ruleId: "code_access_no_auth", severity: "critical", title: "Code critical low confidence", explanation: "CODE_LOW_CONFIDENCE" }),
    codeFinding({ ruleId: "code_secret_hardcoded", severity: "critical", title: "Code critical high confidence", explanation: "CODE_HIGH_CONFIDENCE", file: "src/secret.ts", line: 9 }),
    codeFinding({ ruleId: "code_config_headers", severity: "high", title: "Code high", explanation: "CODE_HIGH" }),
  ];
  const titles = listPaidFindings(report, code).map((item) => `${item.tag}:${item.title}`);
  assert.deepEqual(titles, [
    "Code:Code critical high confidence",
    "Site:Site critical early",
    "Code:Code critical low confidence",
    "Site:Site critical late",
    "Site:Site high",
    "Code:Code high",
    "Site:Site medium",
    "Site:Site low",
    "Site:Site info",
  ]);
  const again = listPaidFindings(report, code).map((item) => item.title);
  assert.deepEqual(
    again,
    listPaidFindings(report, code).map((item) => item.title),
  );
  assert.deepEqual(
    visibleCustomerFindings(report).map((finding) => finding.title),
    ["Site critical early", "Site critical late", "Site high", "Site medium", "Site low", "Site info"],
  );
});

test("markdown and print html use the same severity order and source tags", () => {
  const report = buildCustomerReport({
    scanId: "export-order",
    status: "completed",
    mode: "full",
    access: "full",
    finishedAt: new Date("2026-11-01T00:00:00.000Z"),
    marked,
    unlock: true,
    results: [
      { checkId: "missing_referrer_policy", severity: "low", title: "Referrer stays late", evidence: "LOW_SITE_EVIDENCE" },
      { checkId: "supabase_rls_disabled", severity: "critical", title: "Table is open", evidence: "CRITICAL_SITE_EVIDENCE" },
    ],
  });
  const code = {
    status: "completed",
    empty: false,
    findings: [
      codeFinding({
        ruleId: "code_secret_hardcoded",
        severity: "high",
        title: "Key in source",
        explanation: "HIGH_CODE_EVIDENCE",
        snippet: "semgrep matched a key",
        fixPrompt: "Remove the key.",
      }),
      { severity: "medium" },
    ],
  };
  const listed = orderedListedFindings(report, code);
  assert.deepEqual(
    listed.map((item) => item.title),
    ["Table is open", "Key in source", "Referrer stays late"],
  );
  const markdown = renderFixMarkdown(report, "https://app.example", code);
  const html = renderPrintHtml(report, "https://app.example", null, null, code);
  const markdownTitles = [...markdown.matchAll(/^## \d+\. (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(markdownTitles, ["Table is open", "Key in source", "Referrer stays late"]);
  assert.match(markdown, /- Source: Site/);
  assert.match(markdown, /- Source: Code/);
  assert.ok(markdown.indexOf("Table is open") < markdown.indexOf("Key in source"));
  assert.ok(markdown.indexOf("Key in source") < markdown.indexOf("Referrer stays late"));
  const htmlTitles = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((match) => match[1]);
  assert.deepEqual(htmlTitles.slice(0, 3), ["Table is open", "Key in source", "Referrer stays late"]);
  assert.match(html, /data-source="site"/);
  assert.match(html, /data-source="code"/);
  assert.match(html, /critical · Site/);
  assert.match(html, /high · Code/);
  for (const body of [markdown, html]) {
    assert.equal(body.toLowerCase().includes("semgrep"), false);
    assert.equal(containsToolBrand(body), null);
  }
  assert.match(markdown, /Findings: 4\./);
  assert.match(markdown, /1 Critical, 1 High, 1 Medium, 1 Low/);
  const markdownRoute = readFileSync(path.join(process.cwd(), "src/app/api/scans/[id]/markdown/route.ts"), "utf8");
  const printRoute = readFileSync(path.join(process.cwd(), "src/app/api/scans/[id]/print/route.ts"), "utf8");
  assert.match(markdownRoute, /includeFindings: false/);
  assert.match(printRoute, /includeFindings: false/);
});

test("an unpaid report keeps counts and one lowest finding, and drops every other body", () => {
  const report = buildCustomerReport({
    scanId: "unpaid",
    status: "completed",
    mode: "full",
    access: "full",
    finishedAt: new Date("2026-11-01T00:00:00.000Z"),
    marked,
    unlock: true,
    results: [
      { checkId: "supabase_rls_disabled", severity: "critical", title: "Open table", evidence: "CRITICAL_TABLE_EVIDENCE" },
      { checkId: "exposed_git", severity: "high", title: "Open admin", evidence: "HIGH_ADMIN_EVIDENCE" },
      { checkId: "missing_csp", severity: "medium", title: "Missing policy", evidence: "MEDIUM_CSP_EVIDENCE" },
      { checkId: "missing_referrer_policy", severity: "low", title: "Missing referrer", evidence: "LOW_REFERRER_EVIDENCE" },
      { checkId: "client_backend_config", severity: "info", title: "Client config", evidence: "INFO_CONFIG_EVIDENCE" },
    ],
  });
  const code = [
    codeFinding({
      ruleId: "code_secret_hardcoded",
      severity: "critical",
      title: "SECRET_CODE_TITLE",
      explanation: "SECRET_CODE_EXPLANATION",
      fixPrompt: "SECRET_CODE_FIX",
      snippet: "SECRET_CODE_SNIPPET",
      file: "src/SECRET_CODE_FILE.ts",
    }),
    codeFinding({
      ruleId: "code_config_headers",
      severity: "medium",
      title: "SECRET_MEDIUM_TITLE",
      explanation: "SECRET_MEDIUM_EXPLANATION",
      file: "src/headers.ts",
      line: 12,
    }),
  ];
  const counts = {
    critical: 2,
    high: 1,
    medium: 2,
    low: 1,
    info: 1,
  };
  const safe = clientScanReport({ report, codeFindings: code, counts, includesCode: true, entitled: false });
  assert.equal(safe.report.access, "teaser");
  assert.equal(safe.report.upsell, true);
  assert.equal(safe.report.priority.length, 0);
  assert.equal(safe.report.families.length, 0);
  assert.equal(safe.findings.length, 1);
  assert.equal(safe.findings[0]?.title, "Client config");
  assert.equal(safe.findings[0]?.tag, "Site");
  assert.equal(safe.report.samples.length, 1);
  assert.equal(safe.report.totalFindings, 7);
  assert.equal(safe.report.hiddenCount, 6);
  assert.deepEqual(safe.report.severityCounts, counts);
  const blob = JSON.stringify(safe);
  assert.equal(blob.includes("INFO_CONFIG_EVIDENCE"), true);
  for (const hidden of [
    "CRITICAL_TABLE_EVIDENCE",
    "HIGH_ADMIN_EVIDENCE",
    "MEDIUM_CSP_EVIDENCE",
    "LOW_REFERRER_EVIDENCE",
    "SECRET_CODE_TITLE",
    "SECRET_CODE_EXPLANATION",
    "SECRET_CODE_FIX",
    "SECRET_CODE_SNIPPET",
    "SECRET_CODE_FILE",
    "SECRET_MEDIUM_TITLE",
    "SECRET_MEDIUM_EXPLANATION",
    "Open table",
    "Open admin",
  ]) {
    assert.equal(blob.includes(hidden), false, hidden);
  }
  const locked = lockedSeverityCounts(safe.report.severityCounts, safe.findings[0] ?? null);
  assert.equal(lockedFindingsSummary(locked), "2 critical, 1 high, 2 medium and 1 low findings are locked.");
  const blurred = blurredSeverityLabels(locked);
  assert.equal(blurred.length, FREE_PREVIEW_BLUR_CAP);
  assert.deepEqual(blurred, ["critical", "critical", "high"]);
  assert.equal(blurred.some((label) => label.length > 8), false);

  const codeWins = clientScanReport({
    report: buildCustomerReport({
      scanId: "code-wins",
      status: "completed",
      mode: "mini",
      access: "teaser",
      finishedAt: new Date("2026-11-01T00:00:00.000Z"),
      marked,
      results: [{ checkId: "supabase_rls_disabled", severity: "critical", title: "Open table", evidence: "CRITICAL_ONLY_EVIDENCE" }],
    }),
    codeFindings: [
      codeFinding({
        ruleId: "code_config_headers",
        severity: "info",
        title: "Visible code info",
        explanation: "CODE_INFO_EVIDENCE",
        fixPrompt: "CODE_INFO_FIX",
      }),
    ],
    counts: { critical: 1, high: 0, medium: 0, low: 0, info: 1 },
    includesCode: true,
    entitled: false,
  });
  assert.equal(codeWins.findings.length, 1);
  assert.equal(codeWins.findings[0]?.tag, "Code");
  assert.equal(codeWins.findings[0]?.title, "Visible code info");
  assert.equal(codeWins.report.samples.length, 0);
  const codeBlob = JSON.stringify(codeWins);
  assert.equal(codeBlob.includes("CODE_INFO_EVIDENCE"), true);
  assert.equal(codeBlob.includes("CRITICAL_ONLY_EVIDENCE"), false);
  assert.equal(codeBlob.includes("Open table"), false);
  assert.equal(lockedFindingsSummary(lockedSeverityCounts(codeWins.report.severityCounts, codeWins.findings[0] ?? null)), "1 critical finding is locked.");
});

test("a paid report still returns every site and code finding", () => {
  const report = buildCustomerReport({
    scanId: "paid-all",
    status: "completed",
    mode: "full",
    access: "full",
    finishedAt: new Date("2026-11-01T00:00:00.000Z"),
    marked,
    unlock: true,
    results: [
      { checkId: "supabase_rls_disabled", evidence: "CRITICAL_TABLE_EVIDENCE" },
      { checkId: "missing_referrer_policy", evidence: "LOW_REFERRER_EVIDENCE" },
    ],
  });
  const safe = clientScanReport({
    report,
    codeFindings: [codeFinding({ ruleId: "code_secret_hardcoded", severity: "high", title: "Key in source", explanation: "CODE_BODY" })],
    counts: { critical: 1, high: 1, medium: 0, low: 1, info: 0 },
    includesCode: true,
    entitled: true,
  });
  assert.equal(safe.report.access, "full");
  assert.equal(safe.report.upsell, false);
  assert.equal(safe.findings.length, 3);
  const blob = JSON.stringify(safe);
  assert.equal(blob.includes("CRITICAL_TABLE_EVIDENCE"), true);
  assert.equal(blob.includes("LOW_REFERRER_EVIDENCE"), true);
  assert.equal(blob.includes("CODE_BODY"), true);
  assert.equal(lockedFindingsSummary(lockedSeverityCounts(safe.report.severityCounts, null)), "1 critical, 1 high and 1 low findings are locked.");
});

test("the scan status API does not return finding bodies", () => {
  const body = publicScanStatus({
    status: "completed",
    error: null,
    mode: "mini",
    stage: "report",
    pagesDiscovered: 2,
    startedAt: new Date("2026-11-01T00:00:00.000Z"),
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    codeScan: true,
    codeReport: {
      status: "completed",
      findings: [
        {
          title: "SECRET_API_TITLE",
          explanation: "SECRET_API_EXPLANATION",
          fixPrompt: "SECRET_API_FIX",
          file: "src/secret.ts",
          snippet: "SECRET_API_SNIPPET",
          severity: "critical",
        },
      ],
    },
  });
  assert.equal(body.codeStatus, "completed");
  assert.equal(body.status, "completed");
  assert.equal("findings" in body, false);
  const blob = JSON.stringify(body);
  assert.equal(blob.includes("SECRET_API"), false);
  assert.equal(blob.includes("src/secret.ts"), false);
  const route = readFileSync(path.join(process.cwd(), "src/app/api/scans/[id]/route.ts"), "utf8");
  assert.match(route, /publicScanStatus/);
  assert.doesNotMatch(route, /findings/);
  const view = readFileSync(path.join(process.cwd(), "src/components/ReportView.tsx"), "utf8");
  assert.equal(view.includes("Locked. Upgrade to read this finding."), false);
  assert.match(view, /lockedFindingsSummary/);
  assert.match(view, /FREE_PREVIEW_BLUR_CAP/);
});

test("locked summary omits zero counts and uses a singular verb for one finding", () => {
  assert.equal(lockedFindingsSummary({ critical: 0, high: 0, medium: 0, low: 0, info: 0 }), null);
  assert.equal(lockedFindingsSummary({ critical: 5, high: 8, medium: 3, low: 2, info: 0 }), "5 critical, 8 high, 3 medium and 2 low findings are locked.");
  assert.equal(lockedFindingsSummary({ critical: 0, high: 1, medium: 0, low: 0, info: 0 }), "1 high finding is locked.");
  assert.equal(blurredSeverityLabels({ critical: 0, high: 4, medium: 0, low: 0, info: 0 }).length, 3);
});
