/** Sign-in links stay valid for this long. Email copy reads this value. */
export const MAGIC_LINK_TTL_MS = 30 * 60 * 1000;

export function magicLinkExpiresAt(now = Date.now()): Date {
  return new Date(now + MAGIC_LINK_TTL_MS);
}

/** Human duration for the configured sign-in link lifetime. */
export function formatMagicLinkTtl(ttlMs = MAGIC_LINK_TTL_MS): string {
  const ms = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : MAGIC_LINK_TTL_MS;
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 120) return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  const hours = Math.max(1, Math.round(ms / 3_600_000));
  return hours === 1 ? "1 hour" : `${hours} hours`;
}
