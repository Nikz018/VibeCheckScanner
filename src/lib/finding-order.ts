import { SEVERITIES, type Severity } from "./catalog";
import { codeFindingConfidence } from "./code-scan/score";
import type { CodeFinding } from "./code-scan/types";
import {
  compareByDisplayedSeverity,
  findingTotal,
  visibleCustomerFindings,
  type Confidence,
  type CustomerFinding,
  type CustomerReport,
} from "./report";

export const SOURCE_TAG = { site: "Site", code: "Code" } as const;
export const FREE_PREVIEW_BLUR_CAP = 3;

export interface ListedFinding {
  source: "site" | "code";
  tag: "Site" | "Code";
  severity: Severity;
  title: string;
  confidence?: Confidence;
  tieBreak: string;
  site?: CustomerFinding;
  code?: CodeFinding;
}

export function listPaidFindings(report: CustomerReport, codeFindings: CodeFinding[]): ListedFinding[] {
  return [...visibleCustomerFindings(report).map(siteListing), ...codeFindings.map(codeListing)].sort(byDisplayOrder);
}

/** One finding for an unpaid report: the lowest severity across the site sample and any code findings. */
export function listFreeFindings(report: CustomerReport, codeFindings: CodeFinding[]): ListedFinding[] {
  const candidates = [...visibleCustomerFindings(report).map(siteListing), ...codeFindings.map(codeListing)];
  const lowest = pickLowest(candidates);
  return lowest ? [lowest] : [];
}

export function clientScanReport(input: {
  report: CustomerReport;
  codeFindings: CodeFinding[];
  counts: Record<Severity, number>;
  includesCode: boolean;
  entitled: boolean;
}): { report: CustomerReport; findings: ListedFinding[]; includesCode: boolean } {
  const total = findingTotal(input.counts);
  if (input.entitled) {
    return {
      report: {
        ...input.report,
        severityCounts: input.counts,
        totalFindings: total,
        hiddenCount: 0,
      },
      findings: listPaidFindings(input.report, input.codeFindings),
      includesCode: input.includesCode,
    };
  }
  const findings = listFreeFindings(input.report, input.codeFindings);
  return {
    report: {
      ...input.report,
      access: "teaser",
      upsell: true,
      priority: [],
      families: [],
      samples: findings.flatMap((item) => (item.site ? [item.site] : [])),
      severityCounts: input.counts,
      totalFindings: total,
      hiddenCount: Math.max(0, total - findings.length),
    },
    findings,
    includesCode: input.includesCode,
  };
}

export function lockedSeverityCounts(
  counts: Record<Severity, number>,
  shown: { severity: Severity } | null,
): Record<Severity, number> {
  const locked = { ...counts };
  if (shown && locked[shown.severity] > 0) locked[shown.severity] -= 1;
  return locked;
}

/** "5 critical, 8 high, 3 medium and 2 low findings are locked." Severities with a zero count are omitted. */
export function lockedFindingsSummary(counts: Record<Severity, number>): string | null {
  const parts = SEVERITIES.filter((severity) => (counts[severity] ?? 0) > 0).map((severity) => `${counts[severity]} ${severity}`);
  if (parts.length === 0) return null;
  const total = SEVERITIES.reduce((sum, severity) => sum + (counts[severity] ?? 0), 0);
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const noun = total === 1 ? "finding is" : "findings are";
  return `${list} ${noun} locked.`;
}

/** At most a few severity labels. No titles, evidence, or fixes. */
export function blurredSeverityLabels(counts: Record<Severity, number>, cap = FREE_PREVIEW_BLUR_CAP): Severity[] {
  const rows: Severity[] = [];
  for (const severity of SEVERITIES) {
    const count = counts[severity] ?? 0;
    for (let index = 0; index < count; index += 1) {
      rows.push(severity);
      if (rows.length >= cap) return rows;
    }
  }
  return rows;
}

function siteListing(finding: CustomerFinding, index: number): ListedFinding {
  return {
    source: "site",
    tag: SOURCE_TAG.site,
    severity: finding.severity,
    title: finding.title,
    confidence: finding.confidence,
    tieBreak: `site:${finding.checkId}:${index}`,
    site: finding,
  };
}

function codeListing(finding: CodeFinding, index: number): ListedFinding {
  return {
    source: "code",
    tag: SOURCE_TAG.code,
    severity: finding.severity,
    title: finding.title,
    confidence: codeFindingConfidence(finding.ruleId),
    tieBreak: `code:${finding.ruleId}:${finding.file}:${finding.line}:${index}`,
    code: finding,
  };
}

function byDisplayOrder(a: ListedFinding, b: ListedFinding): number {
  return compareByDisplayedSeverity(a, b);
}

function pickLowest(items: ListedFinding[]): ListedFinding | null {
  if (items.length === 0) return null;
  return [...items].sort((a, b) => {
    const bySeverity = severityIndex(b.severity) - severityIndex(a.severity);
    if (bySeverity !== 0) return bySeverity;
    const byTitle = a.title.localeCompare(b.title);
    if (byTitle !== 0) return byTitle;
    return a.tieBreak.localeCompare(b.tieBreak);
  })[0];
}

function severityIndex(severity: Severity): number {
  const index = SEVERITIES.indexOf(severity);
  return index < 0 ? SEVERITIES.length : index;
}
