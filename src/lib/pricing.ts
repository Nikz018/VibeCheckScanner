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
    name: "Report + rescan",
    priceLabel: "$99",
    amountUsd: 99,
    cadence: "one-time",
    blurb: "Full report on this scan, including signed-in checks with throwaway test accounts, plus one credit to rescan after you ship fixes.",
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

export const FREE_TIER = {
  name: "Free teaser",
  priceLabel: "$0",
  amountUsd: 0,
  blurb: "Run a scan and see severity counts plus two sample issues. The rest of the report stays locked. Logged-in checks are available in the full report.",
};
