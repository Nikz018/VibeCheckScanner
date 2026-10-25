import { formatScoreRatio, scoreBand } from "./score-gauge";

export const DEFAULT_STALE_DAYS = 30;

export const POINT_IN_TIME_DISCLAIMER =
  "This score reflects a scan at one point in time. It is not a guarantee of security, and it is not a promise that the app will stay in this condition. Run a new scan after you ship changes.";

export function staleDays(): number {
  const raw = Number(process.env.BADGE_STALE_DAYS ?? DEFAULT_STALE_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STALE_DAYS;
}

export function isScanStale(finishedAt: Date, now = new Date(), days = staleDays()): boolean {
  return now.getTime() - finishedAt.getTime() > days * 24 * 60 * 60 * 1000;
}

export function formatScanDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export interface BadgeModel {
  score: number;
  finishedAt: Date;
  passed: boolean;
  stale: boolean;
}

export function badgeLabel(model: BadgeModel): string {
  const ratio = `VibeCheck ${formatScoreRatio(model.score)}`;
  if (model.stale) return `rescan needed, ${ratio}`;
  return ratio;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderBadgeSvg(model: BadgeModel): string {
  const ratio = `VibeCheck ${formatScoreRatio(model.score)}`;
  const date = model.stale ? `rescan needed · Scanned ${formatScanDate(model.finishedAt)}` : `Scanned ${formatScanDate(model.finishedAt)}`;
  const band = scoreBand(model.score);
  const label = escapeXml(badgeLabel(model));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="360" height="68" viewBox="0 0 360 68" role="img" aria-label="${label}, ${escapeXml(date)}">
  <rect width="360" height="68" rx="10" fill="#14201b"/>
  <rect x="10" y="14" width="44" height="40" rx="8" fill="${band.color}"/>
  <text x="32" y="39" text-anchor="middle" font-family="Georgia, serif" font-size="16" fill="#14201b">VC</text>
  <text x="66" y="30" font-family="ui-sans-serif, system-ui, sans-serif" font-size="15" font-weight="700" fill="${band.color}">${escapeXml(ratio)}</text>
  <text x="66" y="50" font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" fill="#c9c2b2">${escapeXml(date)}</text>
</svg>`;
}
