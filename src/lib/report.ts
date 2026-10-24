import {
  CHECK_CATALOG,
  FAMILIES,
  SEVERITIES,
  type CheckDefinition,
  type FamilyId,
  type Severity,
  getCheck,
} from "./catalog";
import { clampText, containsToolBrand, sanitizeCustomerText } from "./sanitize";
import { computeScore, isPassingScore } from "./score";
import { POINT_IN_TIME_DISCLAIMER, isScanStale } from "./badge";

export interface RawCheckResult {
  checkId: string;
  evidence: string;
  severity?: Severity;
  title?: string;
  impact?: string;
  fix?: string;
}

export type CheckRunState = "ok" | "error";

export interface CoverageRow {
  family: FamilyId;
  label: string;
  status: "pass" | "findings" | "not_run" | "incomplete" | "error";
  findingCount: number;
  checksRun: string[];
  checksNotRun: string[];
}

export interface CustomerFinding {
  checkId: string;
  family: FamilyId;
  familyLabel: string;
  severity: Severity;
  title: string;
  evidence: string;
  impact: string;
  fix: string;
  headlineRank: number | null;
  locked?: boolean;
}

export interface CustomerReport {
  scanId: string;
  status: string;
  mode: "full" | "mini";
  access: "teaser" | "full";
  finishedAt: string | null;
  score: number | null;
  passed: boolean;
  stale: boolean;
  severityCounts: Record<Severity, number>;
  coverage: CoverageRow[];
  priority: CustomerFinding[];
  families: Array<{ family: FamilyId; label: string; findings: CustomerFinding[] }>;
  samples: CustomerFinding[];
  hiddenCount: number;
  totalFindings: number;
  disclaimer: string;
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export function buildCoverage(marked: Record<string, CheckRunState>, findingIds: string[]): CoverageRow[] {
  const found = new Set(findingIds);
  return FAMILIES.map((family) => {
    const checks = CHECK_CATALOG.filter((check) => check.family === family.id);
    const checksRun = checks.filter((check) => marked[check.id]).map((check) => check.id);
    const checksNotRun = checks.filter((check) => !marked[check.id]).map((check) => check.id);
    const findingCount = checks.filter((check) => found.has(check.id)).length;
    const errored = checksRun.some((id) => marked[id] === "error" && !found.has(id));
    let status: CoverageRow["status"];
    if (checksRun.length === 0) status = "not_run";
    else if (findingCount > 0) status = "findings";
    else if (errored && checksRun.every((id) => marked[id] === "error")) status = "error";
    else if (checksNotRun.length > 0) status = "incomplete";
    else status = "pass";
    return {
      family: family.id,
      label: family.label,
      status,
      findingCount,
      checksRun,
      checksNotRun,
    };
  });
}

function materialize(result: RawCheckResult): CustomerFinding {
  const check: CheckDefinition = getCheck(result.checkId);
  const finding: CustomerFinding = {
    checkId: check.id,
    family: check.family,
    familyLabel: FAMILIES.find((family) => family.id === check.family)?.label ?? check.family,
    severity: result.severity ?? check.severity,
    title: sanitizeCustomerText(result.title ?? check.title),
    evidence: clampText(result.evidence),
    impact: sanitizeCustomerText(result.impact ?? check.impact),
    fix: sanitizeCustomerText(result.fix ?? check.fix),
    headlineRank: check.headlineRank,
  };
  const blob = JSON.stringify(finding);
  const brand = containsToolBrand(blob);
  if (brand) {
    finding.evidence = clampText(finding.evidence.replace(new RegExp(brand, "ig"), "automated check"));
    finding.title = sanitizeCustomerText(finding.title);
    finding.impact = sanitizeCustomerText(finding.impact);
    finding.fix = sanitizeCustomerText(finding.fix);
  }
  return finding;
}

export function sortFindings(findings: CustomerFinding[]): CustomerFinding[] {
  return [...findings].sort((a, b) => {
    const ar = a.headlineRank ?? 100;
    const br = b.headlineRank ?? 100;
    if (ar !== br) return ar - br;
    const as = SEVERITY_RANK[a.severity];
    const bs = SEVERITY_RANK[b.severity];
    if (as !== bs) return as - bs;
    return a.title.localeCompare(b.title);
  });
}

export function buildCustomerReport(input: {
  scanId: string;
  status: string;
  mode: "full" | "mini";
  access: "teaser" | "full";
  finishedAt: Date | null;
  results: RawCheckResult[];
  marked: Record<string, CheckRunState>;
  now?: Date;
}): CustomerReport {
  const findings = sortFindings(input.results.map(materialize));
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<Severity, number>;
  for (const finding of findings) counts[finding.severity] += 1;
  const score = input.status === "completed" ? computeScore(findings) : null;
  const passed = score !== null && isPassingScore(score, findings);
  const stale = input.finishedAt ? isScanStale(input.finishedAt, input.now) : false;
  const coverage = buildCoverage(
    input.marked,
    findings.map((finding) => finding.checkId),
  );
  const priority = findings.filter((finding) => finding.headlineRank !== null);
  const samples = findings.slice(0, 2);

  if (input.access === "teaser") {
    return {
      scanId: input.scanId,
      status: input.status,
      mode: input.mode,
      access: "teaser",
      finishedAt: input.finishedAt?.toISOString() ?? null,
      score,
      passed,
      stale,
      severityCounts: counts,
      coverage,
      priority: [],
      families: [],
      samples,
      hiddenCount: Math.max(0, findings.length - samples.length),
      totalFindings: findings.length,
      disclaimer: POINT_IN_TIME_DISCLAIMER,
    };
  }

  const families = FAMILIES.map((family) => ({
    family: family.id,
    label: family.label,
    findings: findings.filter((finding) => finding.family === family.id),
  })).filter((group) => group.findings.length > 0);

  return {
    scanId: input.scanId,
    status: input.status,
    mode: input.mode,
    access: "full",
    finishedAt: input.finishedAt?.toISOString() ?? null,
    score,
    passed,
    stale,
    severityCounts: counts,
    coverage,
    priority,
    families,
    samples,
    hiddenCount: 0,
    totalFindings: findings.length,
    disclaimer: POINT_IN_TIME_DISCLAIMER,
  };
}

export function assertReportHasNoToolBrands(report: CustomerReport): void {
  const brand = containsToolBrand(JSON.stringify(report));
  if (brand) {
    throw new Error(`Customer report leaked a tool brand: ${brand}`);
  }
}
