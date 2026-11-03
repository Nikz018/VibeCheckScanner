import { renderTransactionalEmail } from "../email-template";

export const FULL_SCAN_PROGRESS_LABEL = "Full scan in progress";
export const FULL_SCAN_STOPPED_LABEL = "Full scan stopped";
export const ACTIVE_SCAN_LIMIT_MESSAGE = "Wait for a running scan to finish before starting another.";
export const QUEUE_UNAVAILABLE_MESSAGE = "The scan queue is unavailable. Retry the full scan when the queue is back.";
export const START_FULL_SCAN_LABEL = "Start the full scan";
export const RETRY_FULL_SCAN_LABEL = "Retry the full scan";
export const CHECK_OWNERSHIP_LABEL = "Check ownership and start the full scan";
export const REVERIFY_OWNERSHIP_LABEL = "Re-verify ownership";
export const OPEN_FULL_REPORT_LABEL = "Open the full report";
export const CONNECT_GITHUB_CODE_SCAN_LABEL = "Connect GitHub to run your code scan";
export const CODE_REPO_STEP_TITLE = "Step 1: Connect your GitHub repo (read-only, one repo, deleted after scan)";
export const SKIP_CODE_SCAN_LABEL = "Skip code scan, scan site only";
export const USE_THIS_REPO_LABEL = "Use this repo";
export const CHANGE_REPO_LABEL = "Change repo";
export const RESCAN_CONFIRMING_DETAIL =
  "This page checks again on its own. After the payment is confirmed, you can connect a repository before the scan starts.";

export const ACTIVE_SCAN_LIMIT = 3;

export function paidReportNotice(host: string, scanUrl: string): { subject: string; text: string; html: string } {
  const subject = "Your VibeCheck full report is ready";
  const lead = `The full report for ${host} is ready.`;
  const rendered = renderTransactionalEmail({
    documentTitle: subject,
    preheader: lead,
    paragraphs: [lead],
    action: { href: scanUrl, label: OPEN_FULL_REPORT_LABEL },
  });
  return { subject, text: rendered.text, html: rendered.html };
}

export function paidReportAlertMessage(host: string): string {
  return `The full report for ${host} is ready.`;
}

export interface PaidScanLink {
  status: string;
  ownershipBlock: string | null;
  startNote: string | null;
  fullScan: { id: string; status: string } | null;
  tier?: string;
  repoConnected?: boolean;
  githubConfigured?: boolean;
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
  if (purchase.tier === "rescan" && purchase.repoConnected === false && purchase.githubConfigured === true) {
    return { href: `/scans/${previewId}#code-scan-step`, label: CONNECT_GITHUB_CODE_SCAN_LABEL };
  }
  return { href: `/scans/${previewId}#upgrade`, label: FULL_SCAN_PROGRESS_LABEL };
}

/** Extra dashboard prompt for a paid $99 scan whose project has no repository yet. */
export function codeScanDashboardPrompt(input: {
  tier: string | null | undefined;
  repoConnected: boolean;
  githubConfigured: boolean;
  previewId: string | null;
  projectId: string;
  fullScan: { id: string; status: string } | null;
}): { href: string; label: string } | null {
  if (!input.githubConfigured || input.tier !== "rescan" || input.repoConnected) return null;
  if (input.fullScan?.status === "completed") {
    return { href: `/scans/${input.fullScan.id}#code-scan`, label: CONNECT_GITHUB_CODE_SCAN_LABEL };
  }
  if (!input.fullScan && input.previewId) {
    return { href: `/scans/${input.previewId}#code-scan-step`, label: CONNECT_GITHUB_CODE_SCAN_LABEL };
  }
  return { href: `/projects/${input.projectId}/github`, label: CONNECT_GITHUB_CODE_SCAN_LABEL };
}
