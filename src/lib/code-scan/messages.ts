/** Customer-facing copy for a code scan that did not produce findings. */

export const CODE_SCAN_FAILED_TITLE = "We couldn't scan your code this time";
export const CODE_SCAN_RETRY_LABEL = "Retry code scan";
export const CODE_SCAN_RETRY_NOTE = "This runs the code scan again. It does not charge you again.";
export const CODE_SCAN_FAILED_NOTICE = "The code scan could not finish. The site results are still available.";
export const CODE_SCAN_EMPTY_NOTICE = "This repository has no commits yet, so there was no code to scan.";
export const CODE_SCAN_SCORE_UNAVAILABLE = "There is no code score and no overall score until a code scan finishes.";

/** Dashboard link when a finished site scan has no code results to show. */
export function codeScanFailurePrompt(input: {
  scanId: string;
  scanStatus: string;
  repoConnected: boolean;
  report: { status?: string | null } | null;
}): { href: string; label: string } | null {
  if (input.scanStatus !== "completed") return null;
  const failed = input.report?.status === "failed" || (!input.report && input.repoConnected);
  if (!failed) return null;
  return { href: `/scans/${input.scanId}#code-scan`, label: CODE_SCAN_FAILED_TITLE };
}
