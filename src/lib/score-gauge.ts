export const SCORE_EXPLAINER =
  "Higher is safer. Each issue lowers the score; critical issues cost the most.";

export type GaugeTone = "light" | "dark";

export interface ScoreBand {
  id: "critical" | "needs-work" | "good" | "strong";
  label: "Critical risk" | "Needs work" | "Good" | "Strong";
  color: string;
}

const BANDS: Array<ScoreBand & { max: number }> = [
  { max: 39, id: "critical", label: "Critical risk", color: "#e24b3a" },
  { max: 69, id: "needs-work", label: "Needs work", color: "#e09a14" },
  { max: 89, id: "good", label: "Good", color: "#9bb42a" },
  { max: 100, id: "strong", label: "Strong", color: "#2f9e5a" },
];

const TONE = {
  light: { track: "#e4dfd2", value: "#14201b", label: "#3d453f" },
  dark: { track: "#3a433e", value: "#f4f0e6", label: "#d9d3c5" },
} as const;

export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function scoreBand(score: number): ScoreBand {
  const value = clampScore(score);
  return BANDS.find((band) => value <= band.max) ?? BANDS[BANDS.length - 1];
}

export function formatScoreRatio(score: number): string {
  return `${clampScore(score)}/100`;
}

/** Upper semicircle, left to right, so the ring fills from the left as the score rises. */
function gaugeArcPath(): string {
  const radius = 74;
  const cx = 100;
  const cy = 96;
  return `M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 0 ${cx + radius} ${cy}`;
}

export function renderScoreGaugeSvg(input: { score: number | null; tone?: GaugeTone }): string {
  const tone = TONE[input.tone ?? "light"];
  const score = input.score === null ? null : clampScore(input.score);
  const band = score === null ? null : scoreBand(score);
  const ratio = score === null ? "—" : formatScoreRatio(score);
  const label = band?.label ?? "";
  const arc = gaugeArcPath();
  const progress =
    score === null || score <= 0
      ? ""
      : `<path class="gauge-progress" d="${arc}" pathLength="100" fill="none" stroke="${band?.color}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${score} 100"/>`;
  const aria = score === null ? "Score not ready" : `${ratio}, ${label}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 136" role="img" aria-label="${escapeXml(aria)}" data-score-gauge="${score ?? ""}">
  <path d="${arc}" fill="none" stroke="${tone.track}" stroke-width="14" stroke-linecap="round"/>
  ${progress}
  <text x="100" y="90" text-anchor="middle" font-family="Georgia, serif" font-size="28" font-weight="700" fill="${tone.value}">${escapeXml(ratio)}</text>
  <text x="100" y="118" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="14" fill="${band ? band.color : tone.label}">${escapeXml(label)}</text>
</svg>`;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
