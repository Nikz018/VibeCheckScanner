import type { Severity } from "@/lib/catalog";
import { SEVERITY_WEIGHTS } from "@/lib/score";
import { clampScore, renderScoreGaugeSvg, scoreBand, type GaugeTone } from "@/lib/score-gauge";
import { CODE_SCAN_EMPTY_NOTICE, CODE_SCAN_SCORE_UNAVAILABLE } from "./messages";
import type { CodeScanReport } from "./types";

/**
 * Concrete matches keep the full site-scan point cost.
 * Anything else is a pattern check and is listed by omission.
 */
export const HIGH_CONFIDENCE_RULES = new Set([
  "code_secret_hardcoded",
  "code_secret_env_file",
  "code_secret_public_env",
  "code_secret_service_role_client",
  "code_secret_git_history",
  "code_ai_provider_key",
  "code_ai_prompt_secret",
  "code_dependency_advisory",
  "code_db_firebase_open",
  "code_db_rls_permissive",
  "code_db_sql_concat",
  "code_inject_eval",
  "code_config_hash",
  "code_pay_webhook",
]);

/** Pattern checks can match safe code, so they cost half the usual severity points. */
export const LOW_CONFIDENCE_PENALTY_FACTOR = 0.5;

/**
 * Overall blends the two scores. The live site is the larger share because those
 * issues are already reachable. The code score is smaller because it includes
 * source that is not public and pattern checks at half weight.
 */
export const OVERALL_SCORE_WEIGHTS = {
  site: 0.6,
  code: 0.4,
} as const;

export function codeFindingConfidence(ruleId: string): "high" | "low" {
  return HIGH_CONFIDENCE_RULES.has(ruleId) ? "high" : "low";
}

export function computeCodeScore(findings: Array<{ severity: Severity; ruleId: string }>): number {
  const penalty = findings.reduce((sum, finding) => {
    const points = SEVERITY_WEIGHTS[finding.severity] ?? 0;
    const factor = codeFindingConfidence(finding.ruleId) === "low" ? LOW_CONFIDENCE_PENALTY_FACTOR : 1;
    return sum + points * factor;
  }, 0);
  return clampScore(100 - penalty);
}

export function computeOverallScore(siteScore: number, codeScore: number): number {
  return clampScore(siteScore * OVERALL_SCORE_WEIGHTS.site + codeScore * OVERALL_SCORE_WEIGHTS.code);
}

export function overallScoreExplanation(): string {
  const sitePct = Math.round(OVERALL_SCORE_WEIGHTS.site * 100);
  const codePct = Math.round(OVERALL_SCORE_WEIGHTS.code * 100);
  const half = Math.round(LOW_CONFIDENCE_PENALTY_FACTOR * 100);
  return `Overall is ${sitePct}% the live site score and ${codePct}% the code score. Both start at 100. Critical issues cost ${SEVERITY_WEIGHTS.critical} points, high ${SEVERITY_WEIGHTS.high}, medium ${SEVERITY_WEIGHTS.medium}, and low ${SEVERITY_WEIGHTS.low}. The site score reflects issues a visitor can already reach. Pattern checks in the code score that are less certain count at ${half}% of those points.`;
}

export interface CombinedScores {
  site: number;
  code: number;
  overall: number;
}

export interface CodeScoreGap {
  site: number;
  reason: string;
}

type ScoreReport = Pick<CodeScanReport, "status" | "findings"> & { empty?: boolean };

/** Scores for a finished $99 code scan. Other plans, and a code scan that has not finished, stay on the site score alone. */
export function combinedScores(input: {
  codeScanEnabled: boolean;
  siteScore: number | null;
  codeReport: ScoreReport | null;
}): CombinedScores | null {
  if (!input.codeScanEnabled || input.siteScore === null) return null;
  if (!input.codeReport || input.codeReport.status !== "completed" || input.codeReport.empty) return null;
  const site = clampScore(input.siteScore);
  const code = computeCodeScore(input.codeReport.findings);
  return { site, code, overall: computeOverallScore(site, code) };
}

/**
 * Site score stays. Code and overall stay blank when the code scan did not
 * produce a result, so a missing scan is not shown as a perfect code score.
 */
export function codeScoreGap(input: {
  codeScanEnabled: boolean;
  siteScore: number | null;
  codeReport: ScoreReport | null;
  repoConnected?: boolean;
  scanStatus?: string;
}): CodeScoreGap | null {
  if (input.scanStatus && input.scanStatus !== "completed") return null;
  if (!input.codeScanEnabled || input.siteScore === null) return null;
  if (combinedScores(input)) return null;
  const site = clampScore(input.siteScore);
  if (input.codeReport?.empty) return { site, reason: CODE_SCAN_EMPTY_NOTICE };
  if (input.codeReport?.status === "failed") return { site, reason: CODE_SCAN_SCORE_UNAVAILABLE };
  if (!input.codeReport && input.repoConnected) return { site, reason: CODE_SCAN_SCORE_UNAVAILABLE };
  return null;
}

export function renderUnavailableScoresHtml(gap: CodeScoreGap, tone: GaugeTone = "light"): string {
  const blanks = [
    { role: "code", label: "Code" },
    { role: "overall", label: "Overall" },
  ];
  const blank = blanks
    .map(
      (ring) =>
        `<div class="gauge${ring.role === "overall" ? " gauge-overall" : ""}" data-score-role="${ring.role}" data-score-unavailable="${ring.role}"><p class="ring-label">${ring.label}</p><p class="unavailable-score">—</p></div>`,
    )
    .join("");
  const siteColor = scoreBand(gap.site).color;
  return `<div class="score-rings"><div class="gauge" data-score-role="site"><p class="ring-label" style="color:${siteColor}">Site</p>${renderScoreGaugeSvg({ score: gap.site, tone })}</div>${blank}</div>`;
}

export function renderScoreRingsHtml(scores: CombinedScores, tone: GaugeTone = "light"): string {
  const rings = [
    { role: "overall", label: "Overall", score: scores.overall, prominent: true },
    { role: "site", label: "Site", score: scores.site, prominent: false },
    { role: "code", label: "Code", score: scores.code, prominent: false },
  ];
  return `<div class="score-rings">${rings
    .map(
      (ring) =>
        `<div class="gauge${ring.prominent ? " gauge-overall" : ""}" data-score-role="${ring.role}"><p class="ring-label" style="color:${scoreBand(ring.score).color}">${ring.label}</p>${renderScoreGaugeSvg({ score: ring.score, tone })}</div>`,
    )
    .join("")}</div>`;
}
