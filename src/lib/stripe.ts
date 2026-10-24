import Stripe from "stripe";
import { TIERS, isTierId, type TierId } from "./pricing";

export { TIERS, isTierId };
export type { TierId };

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

export function priceIdFor(tier: TierId): string | null {
  const value = process.env[TIERS[tier].env];
  return value && value.trim() ? value.trim() : null;
}

export function stripeReady(tier: TierId): boolean {
  return Boolean(getStripe() && priceIdFor(tier) && process.env.APP_URL);
}
