import { getSiteUrl } from "./seo/site";

export const SCANNER_PRODUCT = "VibeCheckScanner/0.1";

/** Public page linked from the scanner User-Agent. */
export const SCANNER_INFO_PATH = "/scanner-info";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function scannerInfoUrl(): string {
  return `${getSiteUrl()}${SCANNER_INFO_PATH}`;
}

/** Identifies the scanner and points at the public explanation. Checks cannot override this. */
export function scannerUserAgent(): string {
  return `${SCANNER_PRODUCT} (+${scannerInfoUrl()})`;
}

/** Mailbox shown on /scanner-info and /contact. Empty when unset or not an email. */
export function abuseContactEmail(raw = process.env.ABUSE_CONTACT_EMAIL): string {
  const value = (raw ?? "").trim();
  if (!value || value.length > 254 || !EMAIL.test(value)) return "";
  return value;
}

/** Product support mailbox. SUPPORT_EMAIL wins; otherwise ABUSE_CONTACT_EMAIL. Empty when neither is a valid email. */
export function supportContactEmail(support = process.env.SUPPORT_EMAIL, abuse = process.env.ABUSE_CONTACT_EMAIL): string {
  const fromSupport = abuseContactEmail(support ?? "");
  if (fromSupport) return fromSupport;
  return abuseContactEmail(abuse ?? "");
}
