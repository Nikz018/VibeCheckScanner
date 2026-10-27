export const FULL_SCAN_PROGRESS_LABEL = "Full scan in progress";
export const FULL_SCAN_STOPPED_LABEL = "Full scan stopped";
export const ACTIVE_SCAN_LIMIT_MESSAGE = "Wait for a running scan to finish before starting another.";
export const QUEUE_UNAVAILABLE_MESSAGE = "The scan queue is unavailable. Retry the full scan when the queue is back.";
export const START_FULL_SCAN_LABEL = "Start the full scan";
export const RETRY_FULL_SCAN_LABEL = "Retry the full scan";
export const CHECK_OWNERSHIP_LABEL = "Check ownership and start the full scan";
export const REVERIFY_OWNERSHIP_LABEL = "Re-verify ownership";
export const OPEN_FULL_REPORT_LABEL = "Open the full report";

export const ACTIVE_SCAN_LIMIT = 3;

export function paidReportNotice(host: string, scanUrl: string): { subject: string; text: string } {
  return {
    subject: "Your VibeCheck full report is ready",
    text: `The full report for ${host} is ready.\n\n${scanUrl}`,
  };
}

export function paidReportAlertMessage(host: string): string {
  return `The full report for ${host} is ready.`;
}

export interface PaidScanLink {
  status: string;
  ownershipBlock: string | null;
  startNote: string | null;
  fullScan: { id: string; status: string } | null;
}

/** Dashboard action for a free preview. A paid order points at the full scan it started. */
export function paidScanDashboardAction(previewId: string, purchase: PaidScanLink | null, upgradeLabel: string): { href: string; label: string } {
  if (!purchase || purchase.status !== "paid") {
    return { href: `/scans/${previewId}#upgrade`, label: upgradeLabel };
  }
  if (purchase.fullScan) {
    if (purchase.fullScan.status === "completed") {
      return { href: `/scans/${purchase.fullScan.id}`, label: OPEN_FULL_REPORT_LABEL };
    }
    if (purchase.fullScan.status === "failed") {
      return { href: `/scans/${purchase.fullScan.id}`, label: FULL_SCAN_STOPPED_LABEL };
    }
    return { href: `/scans/${purchase.fullScan.id}`, label: FULL_SCAN_PROGRESS_LABEL };
  }
  if (purchase.ownershipBlock) {
    return { href: `/scans/${previewId}#upgrade`, label: REVERIFY_OWNERSHIP_LABEL };
  }
  if (purchase.startNote) {
    return { href: `/scans/${previewId}#upgrade`, label: START_FULL_SCAN_LABEL };
  }
  return { href: `/scans/${previewId}#upgrade`, label: FULL_SCAN_PROGRESS_LABEL };
}
