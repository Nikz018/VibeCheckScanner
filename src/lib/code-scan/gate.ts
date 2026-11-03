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

export type CodeScanChoice = "skip" | "connect";

/** A credit-funded code scan exists, but it is not queued until the repository step is decided. */
export const AWAITING_REPO_STATUS = "awaiting_repo";

/**
 * A rescan credit is spent when the scan row is created. Hold that scan whenever the code scan
 * is included and this server can connect a repository, even if one is already connected.
 * The customer confirms that repository, or picks another, before the scan starts.
 * A server without GitHub starts immediately.
 */
export function creditScanShouldWaitForRepo(input: {
  codeScanEnabled: boolean;
  githubConfigured: boolean;
  repoConnected: boolean;
}): boolean {
  return input.codeScanEnabled && input.githubConfigured;
}

/**
 * The connect step for a credit-funded full scan that has not been queued yet.
 * A saved skip or connect choice means the scan was already released.
 */
export function shouldOfferCreditCodeStep(input: {
  mode: string;
  codeScanEnabled: boolean;
  codeScanChoice: string | null | undefined;
  status: string;
  githubConfigured: boolean;
}): boolean {
  if (input.mode !== "full" || !input.codeScanEnabled || !input.githubConfigured) return false;
  if (input.status !== AWAITING_REPO_STATUS) return false;
  if (input.codeScanChoice === "skip" || input.codeScanChoice === "connect") return false;
  return true;
}

/**
 * The connect step is only for a paid $99 scan that has not started, after ownership is verified,
 * and only when this server can actually connect a repository. A saved choice means they already
 * decided, so a later retry starts the scan they asked for.
 */
export function shouldOfferCodeRepoStep(input: {
  tier: string | null | undefined;
  ownershipVerified: boolean;
  githubConfigured: boolean;
  fullScanStarted: boolean;
  codeScanChoice: string | null | undefined;
}): boolean {
  if (!codeScanEnabledForTier(input.tier)) return false;
  if (!input.ownershipVerified || !input.githubConfigured || input.fullScanStarted) return false;
  if (input.codeScanChoice === "skip" || input.codeScanChoice === "connect") return false;
  return true;
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
