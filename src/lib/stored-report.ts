import { SEVERITIES, type Severity } from "./catalog";
import { buildCustomerReport, type CheckRunState, type CustomerReport, type RawCheckResult } from "./report";

export function reportFromStored(input: {
  scanId: string;
  status: string;
  mode: string;
  reportAccess: string;
  finishedAt: Date | null;
  findings: Array<{ checkId: string; evidence: string; severity: string; title: string; impact: string; fix: string }>;
  coverage: unknown;
  now?: Date;
}): CustomerReport {
  const marked = readMarked(input.coverage);
  const results: RawCheckResult[] = input.findings.map((finding) => ({
    checkId: finding.checkId,
    evidence: finding.evidence,
    severity: asSeverity(finding.severity),
    title: finding.title,
    impact: finding.impact,
    fix: finding.fix,
  }));
  return buildCustomerReport({
    scanId: input.scanId,
    status: input.status,
    mode: input.mode === "mini" ? "mini" : "full",
    access: input.reportAccess === "full" ? "full" : "teaser",
    finishedAt: input.finishedAt,
    results,
    marked,
    now: input.now,
  });
}

function readMarked(coverage: unknown): Record<string, CheckRunState> {
  if (!coverage || typeof coverage !== "object" || !("marked" in coverage)) return {};
  const marked = (coverage as { marked?: unknown }).marked;
  if (!marked || typeof marked !== "object") return {};
  const out: Record<string, CheckRunState> = {};
  for (const [key, value] of Object.entries(marked)) {
    if (value === "ok" || value === "error") out[key] = value;
  }
  return out;
}

function asSeverity(value: string): Severity {
  return (SEVERITIES as readonly string[]).includes(value) ? (value as Severity) : "info";
}
