import { toolBrandPattern } from "./tool-denylist";

const SECRET_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bsk_live_[A-Za-z0-9]+/g, "sk_live_redacted"],
  [/\bsk_test_[A-Za-z0-9]+/g, "sk_test_redacted"],
  [/\bsk-[A-Za-z0-9_-]{12,}/g, "sk-redacted"],
  [/\brk_live_[A-Za-z0-9]+/g, "rk_live_redacted"],
  [/\brk_test_[A-Za-z0-9]+/g, "rk_test_redacted"],
  [/\bre_[A-Za-z0-9_]{8,}/g, "re_redacted"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "AKIA_redacted"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[private key redacted]"],
];

export function redactSecrets(input: string): string {
  let out = input;
  for (const [pattern, replacement] of SECRET_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  out = out.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, (token) => {
    const role = jwtRole(token);
    if (role === "service_role") return "[service role credential redacted]";
    if (role === "anon") return "[public client key]";
    return "[credential redacted]";
  });
  return out;
}

export function jwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.length % 4 === 0 ? base64 : base64 + "=".repeat(4 - (base64.length % 4));
    const json = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as { role?: unknown };
    return typeof json.role === "string" ? json.role : null;
  } catch {
    return null;
  }
}

export function sanitizeCustomerText(input: string): string {
  const redacted = redactSecrets(input);
  const stripped = redacted.replace(toolBrandPattern(), "automated check");
  return stripped
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .trim();
}

/** Keeps line breaks and indentation so a copy-paste fix stays readable. */
export function sanitizeCode(input: string): string {
  const redacted = redactSecrets(input).replace(toolBrandPattern(), "automated check");
  return redacted.replace(/\n{4,}/g, "\n\n\n").trim();
}

export function clampText(input: string, max = 700): string {
  const clean = sanitizeCustomerText(input).replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

export function containsToolBrand(input: string): string | null {
  const match = input.match(toolBrandPattern());
  return match ? match[0] : null;
}
