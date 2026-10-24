import type { Severity } from "./catalog";

export const SEVERITY_WEIGHTS: Record<Severity, number> = {
  critical: 25,
  high: 12,
  medium: 6,
  low: 2,
  info: 0,
};

export const PASSING_SCORE = 85;

export function computeScore(findings: Array<{ severity: Severity }>): number {
  const penalty = findings.reduce((sum, finding) => sum + SEVERITY_WEIGHTS[finding.severity], 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

export function isPassingScore(score: number, findings: Array<{ severity: Severity }>): boolean {
  const hasSerious = findings.some((finding) => finding.severity === "critical" || finding.severity === "high");
  return score >= PASSING_SCORE && !hasSerious;
}
