import {
  CHECK_CATALOG,
  FAMILIES,
  SEVERITIES,
  type CheckDefinition,
  type FamilyId,
  type Severity,
  getCheck,
} from "./catalog";
import { POINT_IN_TIME_DISCLAIMER, isScanStale } from "./badge";
import { sanitizeDetail, type FindingDetail, type FindingLocation, type FindingProof } from "./finding-detail";
import { SCAN_LIMITATIONS, SCAN_LIMITATIONS_NOTE, SCAN_LIMITATIONS_TITLE } from "./limitations";
import { clampText, containsToolBrand, sanitizeCode, sanitizeCustomerText } from "./sanitize";
import { computeScore, isPassingScore } from "./score";

export type Confidence = "high" | "medium" | "low";

export interface RawCheckResult {
  checkId: string;
  evidence: string;
  severity?: Severity;
  title?: string;
  impact?: string;
  fix?: string;
  confidence?: Confidence;
  locations?: FindingLocation[];
  proof?: FindingProof;
  steps?: string[];
}

export type CheckRunState = "ok" | "error" | "skipped";

export interface CoverageRow {
  family: FamilyId;
  label: string;
  status: "pass" | "findings" | "not_run" | "incomplete" | "error" | "skipped";
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
  confidence?: Confidence;
  locations?: FindingLocation[];
  proof?: FindingProof;
  steps?: string[];
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
  notices: string[];
  limitationsTitle: string;
  limitations: string[];
  limitationsNote: string;
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
    const skippedCount = checksRun.filter((id) => marked[id] === "skipped").length;
    let status: CoverageRow["status"];
    if (checksRun.length === 0) status = "not_run";
    else if (findingCount > 0) status = "findings";
    else if (errored && checksRun.every((id) => marked[id] === "error")) status = "error";
    else if (checksNotRun.length > 0) status = "incomplete";
    else if (skippedCount > 0 && skippedCount === checksRun.length) status = "skipped";
    else if (skippedCount > 0) status = "incomplete";
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
    fix: sanitizeCode(result.fix ?? check.fix),
    headlineRank: check.headlineRank,
  };
  if (result.confidence) finding.confidence = result.confidence;
  if (result.locations && result.proof && result.steps) {
    const detail: FindingDetail = sanitizeDetail({
      locations: result.locations,
      proof: result.proof,
      steps: result.steps,
    });
    finding.locations = detail.locations;
    finding.proof = detail.proof;
    finding.steps = detail.steps;
  }
  const blob = JSON.stringify(finding);
  const brand = containsToolBrand(blob);
  if (brand) {
    const pattern = new RegExp(brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
    finding.evidence = clampText(finding.evidence.replace(pattern, "automated check"));
    finding.title = sanitizeCustomerText(finding.title);
    finding.impact = sanitizeCustomerText(finding.impact);
    finding.fix = sanitizeCode(finding.fix);
    if (finding.steps) finding.steps = finding.steps.map((step) => step.replace(pattern, "automated check"));
    if (finding.proof) finding.proof.responseSnippet = finding.proof.responseSnippet.replace(pattern, "automated check");
  }
  return finding;
}

/** A full paid report is a full-mode scan that was unlocked. Mini previews stay free even when stored access is "full". */
export function isFreeTierDelivery(input: { mode: "full" | "mini"; access: "teaser" | "full" }): boolean {
  return !(input.mode === "full" && input.access === "full");
}

/** Least severe finding. Ties break by title, then check id, so the choice is stable. */
export function lowestSeverityFinding(findings: CustomerFinding[]): CustomerFinding | null {
  if (findings.length === 0) return null;
  return [...findings].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (bySeverity !== 0) return bySeverity;
    const byTitle = a.title.localeCompare(b.title);
    if (byTitle !== 0) return byTitle;
    return a.checkId.localeCompare(b.checkId);
  })[0];
}

export function formatSeverityBreakdown(counts: Record<Severity, number>): string {
  return SEVERITIES.filter((severity) => (counts[severity] ?? 0) > 0)
    .map((severity) => {
      const count = counts[severity] ?? 0;
      const label = severity.charAt(0).toUpperCase() + severity.slice(1);
      return `${count} ${label}`;
    })
    .join(", ");
}

export function readSeverityCounts(value: unknown): Record<Severity, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<Severity, number>;
  let seen = false;
  for (const severity of SEVERITIES) {
    const raw = record[severity];
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) continue;
    counts[severity] = Math.floor(raw);
    seen = true;
  }
  return seen ? counts : null;
}

/** Severity labels for withheld findings. Derived from counts, never from hidden titles or evidence. */
export function lockedSeverityRows(report: Pick<CustomerReport, "access" | "samples" | "severityCounts">): Severity[] {
  if (report.access !== "teaser") return [];
  const counts = { ...report.severityCounts };
  const shown = report.samples[0];
  if (shown && counts[shown.severity] > 0) counts[shown.severity] -= 1;
  const rows: Severity[] = [];
  for (const severity of SEVERITIES) {
    for (let index = 0; index < counts[severity]; index += 1) rows.push(severity);
  }
  return rows;
}

/** Findings that may be sent to a browser, file, or email. Free tier returns the one revealed finding. */
export function visibleCustomerFindings(report: CustomerReport): CustomerFinding[] {
  if (report.access === "teaser") return [...report.samples];
  const seen = new Set<string>();
  const ordered: CustomerFinding[] = [];
  for (const finding of [...report.priority, ...report.families.flatMap((group) => group.findings)]) {
    if (seen.has(finding.checkId)) continue;
    seen.add(finding.checkId);
    ordered.push(finding);
  }
  return ordered;
}

export const FREE_PREVIEW_LABEL = "Free preview";
export const FULL_REPORT_PURCHASE_LEDE = "After purchase, the full report runs every check on this origin.";
export const RESCAN_PURCHASE_NOTE = "The same full scan, plus one credit to run another full scan after you ship fixes.";

export interface FreePreviewFacts {
  findingsShown: number;
  checksRun: number;
  checksNotRun: number;
  hiddenFindings: number;
  familiesNotRun: string[];
}

export function freePreviewFacts(report: Pick<CustomerReport, "coverage" | "access" | "samples" | "totalFindings" | "hiddenCount">): FreePreviewFacts {
  let checksRun = 0;
  let checksNotRun = 0;
  const familiesNotRun: string[] = [];
  for (const row of report.coverage) {
    checksRun += row.checksRun.length;
    checksNotRun += row.checksNotRun.length;
    if (row.checksRun.length === 0) familiesNotRun.push(row.label);
  }
  return {
    findingsShown: report.access === "teaser" ? report.samples.length : report.totalFindings,
    checksRun,
    checksNotRun,
    hiddenFindings: report.hiddenCount,
    familiesNotRun,
  };
}

function countNoun(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Sentences use only counts present on the report. Missing checks are not turned into findings. */
export function freePreviewLines(facts: FreePreviewFacts): string[] {
  const lines = [`This free preview shows ${countNoun(facts.findingsShown, "finding")} from ${countNoun(facts.checksRun, "check")}.`];
  const totalChecks = facts.checksRun + facts.checksNotRun;
  if (totalChecks > 0) {
    lines.push(`After purchase, the full report runs all ${countNoun(totalChecks, "check")} on this origin.`);
  }
  if (facts.checksNotRun > 0) {
    lines.push(`That includes ${countNoun(facts.checksNotRun, "check")} that did not run on this preview.`);
  }
  if (facts.hiddenFindings > 0) {
    const verb = facts.hiddenFindings === 1 ? "is" : "are";
    lines.push(`${countNoun(facts.hiddenFindings, "finding")} from checks that already ran ${verb} in the full report.`);
  }
  if (facts.familiesNotRun.length > 0) {
    lines.push(`Families not run on this preview: ${facts.familiesNotRun.join(", ")}.`);
  }
  return lines;
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
  notices?: string[];
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
  const notices = [...new Set((input.notices ?? []).filter((notice) => notice.trim().length > 0))];
  const shared = {
    notices,
    limitationsTitle: SCAN_LIMITATIONS_TITLE,
    limitations: [...SCAN_LIMITATIONS],
    limitationsNote: SCAN_LIMITATIONS_NOTE,
  };

  if (isFreeTierDelivery({ mode: input.mode, access: input.access })) {
    const revealed = lowestSeverityFinding(findings);
    const samples = revealed ? [revealed] : [];
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
      ...shared,
    };
  }

  const samples = findings.slice(0, 2);

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
    ...shared,
  };
}

export function assertReportHasNoToolBrands(report: CustomerReport): void {
  const brand = containsToolBrand(JSON.stringify(report));
  if (brand) {
    throw new Error(`Customer report leaked a tool brand: ${brand}`);
  }
}
