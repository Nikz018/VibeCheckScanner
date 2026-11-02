import type { Severity } from "@/lib/catalog";

/** OWASP Top 10 2021 categories these checks align with. Not a certification. */
export const OWASP_TOP_10 = [
  { id: "A01:2021", name: "Broken Access Control" },
  { id: "A02:2021", name: "Cryptographic Failures" },
  { id: "A03:2021", name: "Injection" },
  { id: "A04:2021", name: "Insecure Design" },
  { id: "A05:2021", name: "Security Misconfiguration" },
  { id: "A06:2021", name: "Vulnerable and Outdated Components" },
  { id: "A07:2021", name: "Identification and Authentication Failures" },
  { id: "A08:2021", name: "Software and Data Integrity Failures" },
  { id: "A09:2021", name: "Security Logging and Monitoring Failures" },
  { id: "A10:2021", name: "Server-Side Request Forgery" },
] as const;

export type OwaspId = (typeof OWASP_TOP_10)[number]["id"];

export type OwaspStatus = "passed" | "issues_found" | "not_checked";

export interface OwaspRow {
  id: OwaspId;
  name: string;
  status: OwaspStatus;
  findingCount: number;
}

export const CODE_FAMILIES = [
  "Secrets",
  "Dependencies",
  "Access control",
  "Database",
  "Injection and output",
  "Configuration",
  "Payments",
  "Logging",
  "AI security",
] as const;

export type CodeFamily = (typeof CODE_FAMILIES)[number];

export type RuleScope = "agnostic" | "javascript" | "sql" | "firebase" | "manifest";

/** Languages the walker understands. Python rules can be pushed into PYTHON_RULES later. */
export type SourceLanguage = "javascript" | "python";

export interface CodeFinding {
  ruleId: string;
  family: CodeFamily;
  file: string;
  line: number;
  snippet: string;
  severity: Severity;
  title: string;
  explanation: string;
  owasp: OwaspId;
  fixPrompt: string;
}

export interface CodeScanReport {
  status: "completed" | "skipped" | "failed" | "not_connected" | "running" | "queued";
  privacy: string;
  repo: string | null;
  commit: string | null;
  filesScanned: number;
  findings: CodeFinding[];
  owasp: OwaspRow[];
  notices: string[];
  owaspNote: string;
}

export interface SourceFile {
  relativePath: string;
  kind: "javascript" | "python" | "sql" | "firebase" | "env" | "manifest" | "lock" | "config" | "text";
  language: SourceLanguage | null;
  text: string;
}

export interface HistoryHit {
  commit: string;
  path: string;
  lineText: string;
}
