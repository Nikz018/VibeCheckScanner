import { isTierId, type TierId } from "./pricing";

export function pricingCheckoutPath(tier: TierId): string {
  return `/pricing?checkout=${tier}`;
}

export function scanCheckoutPath(scanId: string, tier: TierId): string {
  return `/scans/${scanId}?checkout=${tier}#upgrade`;
}

export function scanPageReturnPath(scanId: string, checkout: string | undefined): string {
  const tier = tierFromCheckoutParam(checkout);
  if (tier) return scanCheckoutPath(scanId, tier);
  if (checkout === "success" || checkout === "cancel") return `/scans/${scanId}?checkout=${checkout}`;
  return `/scans/${scanId}`;
}

export function signInPath(nextPath: string, options?: { expired?: boolean }): string {
  const safe = nextPath.startsWith("/") && !nextPath.startsWith("//");
  if (options?.expired) {
    return safe ? `/api/auth/expired?next=${encodeURIComponent(nextPath)}` : "/api/auth/expired";
  }
  if (!safe) return "/login";
  return `/login?next=${encodeURIComponent(nextPath)}`;
}

export function tierFromCheckoutParam(value: string | undefined): TierId | null {
  if (!value || !isTierId(value)) return null;
  return value;
}
