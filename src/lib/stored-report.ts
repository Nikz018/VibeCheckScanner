import { SEVERITIES, type Severity } from "./catalog";
import { parseStoredDetail } from "./finding-detail";
import { buildCustomerReport, type CheckRunState, type CustomerReport, type RawCheckResult } from "./report";

export function reportFromStored(input: {
  scanId: string;
  status: string;
  mode: string;
  reportAccess: string;
  finishedAt: Date | null;
  findings: Array<{ checkId: string; evidence: string; severity: string; title: string; impact: string; fix: string; raw?: unknown }>;
  coverage: unknown;
  now?: Date;
}): CustomerReport {
  const marked = readMarked(input.coverage);
  const results: RawCheckResult[] = input.findings.map((finding) => {
    const detail = parseStoredDetail(finding.raw);
    return {
      checkId: finding.checkId,
      evidence: finding.evidence,
      severity: asSeverity(finding.severity),
      title: finding.title,
      impact: finding.impact,
      fix: finding.fix,
      locations: detail.locations,
      proof: detail.proof,
      steps: detail.steps,
      confidence: detail.confidence,
      affectedPages: detail.affectedPages,
    };
  });
  return buildCustomerReport({
    scanId: input.scanId,
    status: input.status,
    mode: input.mode === "mini" ? "mini" : "full",
    access: input.reportAccess === "full" ? "full" : "teaser",
    finishedAt: input.finishedAt,
    results,
    marked,
    notices: readNotices(input.coverage),
    pagesScanned: readPagesScanned(input.coverage),
    now: input.now,
  });
}

function readMarked(coverage: unknown): Record<string, CheckRunState> {
  if (!coverage || typeof coverage !== "object" || !("marked" in coverage)) return {};
  const marked = (coverage as { marked?: unknown }).marked;
  if (!marked || typeof marked !== "object") return {};
  const out: Record<string, CheckRunState> = {};
  for (const [key, value] of Object.entries(marked)) {
    if (value === "ok" || value === "error" || value === "skipped") out[key] = value;
  }
  return out;
}

function readPagesScanned(coverage: unknown): number | null {
  if (!coverage || typeof coverage !== "object" || !("pagesScanned" in coverage)) return null;
  const value = (coverage as { pagesScanned?: unknown }).pagesScanned;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

function readNotices(coverage: unknown): string[] {
  if (!coverage || typeof coverage !== "object" || !("notices" in coverage)) return [];
  const notices = (coverage as { notices?: unknown }).notices;
  if (!Array.isArray(notices)) return [];
  return notices.filter((notice): notice is string => typeof notice === "string" && notice.trim().length > 0);
}

function asSeverity(value: string): Severity {
  return (SEVERITIES as readonly string[]).includes(value) ? (value as Severity) : "info";
}
