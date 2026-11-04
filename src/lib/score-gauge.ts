export const SCORE_EXPLAINER =
  "Higher is safer. Each issue lowers the score; critical issues cost the most.";

export type GaugeTone = "light" | "dark";

export interface ScoreBand {
  id: "critical" | "needs-work" | "good" | "strong";
  label: "Critical risk" | "Needs work" | "Good" | "Strong";
  color: string;
}

const BANDS: Array<ScoreBand & { max: number; onLight?: string }> = [
  { max: 39, id: "critical", label: "Critical risk", color: "#e24b3a" },
  { max: 69, id: "needs-work", label: "Needs work", color: "#e09a14" },
  // Coral replaces the old lime for "good". Dark surfaces use the bright accent.
  // Light surfaces (the PDF gauge) use a deeper coral so the word stays readable.
  { max: 89, id: "good", label: "Good", color: "#ff6a3d", onLight: "#c4471a" },
  { max: 100, id: "strong", label: "Strong", color: "#2f9e5a" },
];

const TONE = {
  light: { track: "#e4dfd2", value: "#14201b", label: "#3d453f" },
  dark: { track: "#3a332f", value: "#f4f0e6", label: "#d9d3c5" },
} as const;

export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function bandFor(score: number): (typeof BANDS)[number] {
  const value = clampScore(score);
  return BANDS.find((band) => value <= band.max) ?? BANDS[BANDS.length - 1];
}

export function scoreBand(score: number): ScoreBand {
  const band = bandFor(score);
  return { id: band.id, label: band.label, color: band.color };
}

/** Ring and label paint. Light tone deepens the "good" coral so it stays readable on white. */
export function scoreBandPaint(score: number, tone: GaugeTone = "dark"): string {
  const band = bandFor(score);
  return tone === "light" && band.onLight ? band.onLight : band.color;
}

export function formatScoreRatio(score: number): string {
  return `${clampScore(score)}/100`;
}

/** Full ring. The ratio and band sit in the open center so they are not covered by the stroke. */
export function renderScoreGaugeSvg(input: { score: number | null; tone?: GaugeTone }): string {
  const toneName = input.tone ?? "light";
  const tone = TONE[toneName];
  const score = input.score === null ? null : clampScore(input.score);
  const band = score === null ? null : scoreBand(score);
  const paint = score === null ? tone.label : scoreBandPaint(score, toneName);
  const ratio = score === null ? "—" : formatScoreRatio(score);
  const label = band?.label ?? "";
  const progress =
    score === null || score <= 0
      ? ""
      : `<circle class="gauge-progress" cx="100" cy="100" r="78" fill="none" stroke="${paint}" stroke-width="12" stroke-linecap="round" pathLength="100" stroke-dasharray="${score} 100" transform="rotate(-90 100 100)"/>`;
  const aria = score === null ? "Score not ready" : `${ratio}, ${label}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" role="img" aria-label="${escapeXml(aria)}" data-score-gauge="${score ?? ""}">
  <circle cx="100" cy="100" r="78" fill="none" stroke="${tone.track}" stroke-width="12"/>
  ${progress}
  <text x="100" y="96" text-anchor="middle" font-family="Georgia, serif" font-size="28" font-weight="700" fill="${tone.value}">${escapeXml(ratio)}</text>
  <text x="100" y="122" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="13" fill="${paint}">${escapeXml(label)}</text>
</svg>`;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
