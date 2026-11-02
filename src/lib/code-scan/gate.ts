/**
 * The $99 plan is the existing `rescan` tier. $49 reports and monitoring do not include a code scan.
 * A rescan credit only counts after it is actually spent, so a subscriber selecting that option
 * without a credit does not unlock the code scan.
 */

export function codeScanEnabledForTier(tier: string | null | undefined): boolean {
  return tier === "rescan";
}

export function codeScanEnabledForCredit(input: { mode: string; use: string; spentRescanCredit: boolean }): boolean {
  return input.mode === "full" && input.use === "rescan" && input.spentRescanCredit;
}

export function canConnectRepository(input: {
  ownershipVerified: boolean;
  paidRescan: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.paidRescan) {
    return { ok: false, reason: "Code scan is included with the $99 site + code scan plan." };
  }
  if (!input.ownershipVerified) {
    return { ok: false, reason: "Verify ownership of this origin before connecting a repository." };
  }
  return { ok: true };
}

export function canRunCodeScan(input: { ownershipVerified: boolean; codeScanEnabled: boolean; repoConnected: boolean }): { ok: true } | { ok: false; reason: string } {
  if (!input.codeScanEnabled) {
    return { ok: false, reason: "Code scan is included with the $99 site + code scan plan." };
  }
  if (!input.ownershipVerified) {
    return { ok: false, reason: "Verify ownership of this origin before the code scan reads a repository." };
  }
  if (!input.repoConnected) {
    return { ok: false, reason: "Connect one repository before running the code scan." };
  }
  return { ok: true };
}
