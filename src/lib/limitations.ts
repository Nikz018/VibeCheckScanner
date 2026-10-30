export const SCAN_LIMITATIONS_TITLE = "What this scan does not cover";

export const SCAN_LIMITATIONS = [
  "Business-logic flaws, such as a workflow that does the wrong thing for a valid user.",
  "Write or delete abuse. Probes are read-only, so a bug that only appears when data is changed is not proven.",
  "Private source and lockfiles. Library versions are read only from pages and scripts the site already serves, and from a public package.json when one is present.",
  "Load testing and brute-force testing.",
  "Mobile apps and backends that are not part of this web origin.",
  "Subdomains and other hosts are not crawled. Pages beyond the page limit are not scanned.",
] as const;

export const SCAN_LIMITATIONS_NOTE =
  "A manual pentest is a better fit when you need those covered in depth.";

export const LOGIN_FAILED_NOTICE =
  "Logged-in checks skipped: login failed. Confirm the throwaway test account can sign in at the login URL, or paste a session cookie or bearer token from that test account. Unauthenticated checks still ran.";

export const LOGIN_AVAILABLE_NOTICE = "Logged-in checks are available in the full report.";

export const LOGIN_NOT_INCLUDED_NOTICE =
  "Logged-in checks were not included. Add throwaway test accounts on a full report to run them.";

export function limitationsParagraph(): string {
  return `${SCAN_LIMITATIONS_TITLE}: ${SCAN_LIMITATIONS.join(" ")} ${SCAN_LIMITATIONS_NOTE}`;
}
