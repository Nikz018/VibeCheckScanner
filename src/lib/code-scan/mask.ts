import { redactSecrets } from "@/lib/sanitize";

const EXTRA: Array<[RegExp, string]> = [
  [/\bgsk_[A-Za-z0-9]{8,}/g, "gsk_redacted"],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, "AIza_redacted"],
  [/\bghp_[A-Za-z0-9]{16,}/g, "ghp_redacted"],
  [/\bgho_[A-Za-z0-9]{16,}/g, "gho_redacted"],
  [/\bxai-[A-Za-z0-9_-]{12,}/g, "xai-redacted"],
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, "sk-ant-redacted"],
];

/** Mask secrets and emails in text that may be stored. Does not shorten the text. */
export function maskSecretsInText(input: string): string {
  let out = redactSecrets(input);
  for (const [pattern, replacement] of EXTRA) out = out.replace(pattern, replacement);
  out = out.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, "[credential redacted]");
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");
  return out;
}

/** One short line for the report. Secrets are masked before the cut. */
export function maskSnippet(input: string): string {
  const clean = maskSecretsInText(input).replace(/\s+/g, " ").trim();
  if (clean.length <= 180) return clean;
  return `${clean.slice(0, 179)}…`;
}
