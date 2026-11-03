import { SEVERITIES, type Severity } from "@/lib/catalog";
import { maskSecretsInText, maskSnippet } from "./mask";
import { emptyOwasp } from "./owasp";
import { CODE_PRIVACY_PROMISE, OWASP_ALIGNMENT } from "./privacy";
import { CODE_FAMILIES, OWASP_TOP_10, type CodeFamily, type CodeFinding, type CodeScanReport, type OwaspId, type OwaspStatus } from "./types";

const STATUSES = new Set(["completed", "skipped", "failed", "not_connected", "running", "queued"]);
const OWP_STATUS = new Set(["passed", "issues_found", "not_checked"]);

export function shellCodeReport(status: CodeScanReport["status"], notices: string[], repo: string | null = null): CodeScanReport {
  return {
    status,
    privacy: CODE_PRIVACY_PROMISE,
    repo,
    commit: null,
    filesScanned: 0,
    findings: [],
    owasp: emptyOwasp(),
    notices,
    owaspNote: OWASP_ALIGNMENT,
  };
}

export function parseCodeReport(value: unknown): CodeScanReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const status = typeof record.status === "string" && STATUSES.has(record.status) ? (record.status as CodeScanReport["status"]) : null;
  if (!status) return null;
  const findings = Array.isArray(record.findings) ? record.findings.map(parseFinding).filter((finding): finding is CodeFinding => finding !== null) : [];
  const owasp = Array.isArray(record.owasp) ? parseOwasp(record.owasp) : emptyOwasp();
  const notices = Array.isArray(record.notices) ? record.notices.filter((notice): notice is string => typeof notice === "string").slice(0, 12) : [];
  return {
    status,
    privacy: CODE_PRIVACY_PROMISE,
    repo: typeof record.repo === "string" ? record.repo.slice(0, 200) : null,
    commit: typeof record.commit === "string" ? record.commit.slice(0, 80) : null,
    filesScanned: typeof record.filesScanned === "number" && record.filesScanned >= 0 ? Math.floor(record.filesScanned) : 0,
    findings,
    owasp,
    notices: notices.map((notice) => maskSecretsInText(notice).slice(0, 400)),
    owaspNote: OWASP_ALIGNMENT,
    empty: record.empty === true,
  };
}

function parseFinding(value: unknown): CodeFinding | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.ruleId !== "string" || typeof record.file !== "string" || typeof record.title !== "string") return null;
  const family = CODE_FAMILIES.find((item) => item === record.family);
  const owasp = OWASP_TOP_10.find((item) => item.id === record.owasp)?.id;
  if (!family || !owasp) return null;
  const severity = (SEVERITIES as readonly string[]).includes(String(record.severity)) ? (record.severity as Severity) : "info";
  const line = typeof record.line === "number" && record.line > 0 ? Math.floor(record.line) : 1;
  return {
    ruleId: record.ruleId.slice(0, 80),
    family: family as CodeFamily,
    file: record.file.replace(/\\/g, "/").slice(0, 240),
    line,
    snippet: maskSnippet(typeof record.snippet === "string" ? record.snippet : ""),
    severity,
    title: maskSecretsInText(record.title).slice(0, 180),
    explanation: maskSecretsInText(typeof record.explanation === "string" ? record.explanation : "").slice(0, 700),
    owasp: owasp as OwaspId,
    fixPrompt: maskSecretsInText(typeof record.fixPrompt === "string" ? record.fixPrompt : "").slice(0, 1200),
  };
}

function parseOwasp(value: unknown[]): CodeScanReport["owasp"] {
  const rows = emptyOwasp();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const row = rows.find((candidate) => candidate.id === record.id);
    if (!row) continue;
    if (typeof record.status === "string" && OWP_STATUS.has(record.status)) row.status = record.status as OwaspStatus;
    if (typeof record.findingCount === "number" && record.findingCount >= 0) row.findingCount = Math.floor(record.findingCount);
  }
  return rows;
}
