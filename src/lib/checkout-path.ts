import { isTierId, type TierId } from "./pricing";

export function pricingCheckoutPath(tier: TierId): string {
  return `/pricing?checkout=${tier}`;
}

export function scanCheckoutPath(scanId: string, tier: TierId): string {
  return `/scans/${scanId}?checkout=${tier}#upgrade`;
}

export function signInPath(nextPath: string): string {
  if (!nextPath.startsWith("/") || nextPath.startsWith("//")) return "/login";
  return `/login?next=${encodeURIComponent(nextPath)}`;
}

export function tierFromCheckoutParam(value: string | undefined): TierId | null {
  if (!value || !isTierId(value)) return null;
  return value;
}
