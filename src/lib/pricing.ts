export const TIERS = {
  report: {
    id: "report",
    env: "STRIPE_PRICE_REPORT",
    dodoEnv: "DODO_PRODUCT_REPORT",
    name: "Full report",
    priceLabel: "$49",
    amountUsd: 49,
    cadence: "one-time",
    blurb: "Unlock the full report for one scan: every finding, evidence, copy-paste fixes, and signed-in checks with throwaway test accounts.",
    mode: "payment" as const,
  },
  rescan: {
    id: "rescan",
    env: "STRIPE_PRICE_RESCAN",
    dodoEnv: "DODO_PRODUCT_RESCAN",
    name: "Site + code scan",
    priceLabel: "$99",
    amountUsd: 99,
    cadence: "one-time",
    blurb: "Full site report plus an in-depth source code scan with AI app security checks, and one credit to rescan after you ship fixes. The repository is cloned only long enough to scan, then deleted. Your code is not stored or used for training.",
    mode: "payment" as const,
  },
  monitor: {
    id: "monitor",
    env: "STRIPE_PRICE_MONITOR",
    dodoEnv: "DODO_PRODUCT_MONITOR",
    name: "Continuous monitoring",
    priceLabel: "$29/mo",
    amountUsd: 29,
    cadence: "monthly",
    blurb: "Scheduled rescans of a verified app and an alert when a new high-severity issue shows up.",
    mode: "subscription" as const,
  },
} as const;

export type TierId = keyof typeof TIERS;

export function isTierId(value: string): value is TierId {
  return value in TIERS;
}

export const TAX_NOTE = "plus applicable taxes";

export const CHECKOUT_SETUP_MESSAGE = "Checkout is being set up, try again soon.";

/** Live Dodo product IDs. Env vars override these. Not secrets. */
export const DEFAULT_DODO_PRODUCT_IDS: Record<TierId, string> = {
  report: "pdt_0NqUPK77rA0fd1CknGv8C",
  rescan: "pdt_0NqUQCBmdARxCAyoaIRVZ",
  monitor: "pdt_0NqUQeUgIBSIizoXIrkrJ",
};

export const UPGRADE_ACTIONS: Record<TierId, string> = {
  report: "Upgrade to full report",
  rescan: "Upgrade to site + code scan",
  monitor: "Start monitoring",
};

export const FREE_TIER = {
  name: "Free teaser",
  priceLabel: "$0",
  amountUsd: 0,
  blurb: "Run a scan and see the real severity counts plus the lowest-severity finding in full. Every other finding stays off the page. Logged-in checks are available in the full report.",
};
