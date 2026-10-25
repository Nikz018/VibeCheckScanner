/** Absolute origin for SEO. NEXT_PUBLIC_SITE_URL wins; APP_URL is only a local fallback. */
export function normalizeSiteUrl(raw: string | undefined): string {
  const value = (raw || "http://localhost:3000").trim();
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(withProtocol).origin;
  } catch {
    return "http://localhost:3000";
  }
}

export function getSiteUrl(): string {
  return normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_URL);
}

export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized === "/") return getSiteUrl();
  return `${getSiteUrl()}${normalized}`;
}
