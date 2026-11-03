import type { CodeScanReport } from "./types";
import { CODE_SCAN_EMPTY_NOTICE, CODE_SCAN_FAILED_NOTICE, CODE_SCAN_FAILED_TITLE } from "./messages";
import { owaspStatusLabel } from "./owasp";
import { CODE_SCAN_LIMITATIONS } from "./privacy";

export function renderCodeScanMarkdown(report: CodeScanReport | null): string {
  if (!report || report.status === "skipped") return "";
  const lines: string[] = ["## Code scan", "", report.privacy, "", report.owaspNote, ""];
  if (report.repo) lines.push(`Repository: ${report.repo}`, "");
  if (report.empty) {
    lines.push(CODE_SCAN_EMPTY_NOTICE, "");
    return `${lines.join("\n")}\n`;
  }
  if (report.status !== "completed") {
    if (report.status === "failed") lines.push(CODE_SCAN_FAILED_TITLE, "");
    lines.push(report.notices[0] || (report.status === "failed" ? CODE_SCAN_FAILED_NOTICE : "The code scan did not finish."), "");
    return `${lines.join("\n")}\n`;
  }
  lines.push("### OWASP Top 10 coverage", "");
  for (const row of report.owasp) {
    lines.push(`- ${row.id} ${row.name}: ${owaspStatusLabel(row.status)}`);
  }
  lines.push("");
  if (report.findings.length === 0) lines.push("No code findings.", "");
  report.findings.forEach((finding, index) => {
    lines.push(`### Code ${index + 1}. ${finding.title}`, "");
    lines.push(`- Severity: ${finding.severity}`);
    lines.push(`- File: ${finding.file}`);
    lines.push(`- Line: ${finding.line}`);
    lines.push(`- Category: ${finding.owasp}`);
    lines.push("");
    lines.push(finding.explanation);
    lines.push("");
    if (finding.snippet) {
      lines.push("Excerpt:");
      lines.push("");
      lines.push("```");
      lines.push(finding.snippet);
      lines.push("```");
      lines.push("");
    }
    lines.push("Fix prompt:");
    lines.push("");
    lines.push("```");
    lines.push(finding.fixPrompt);
    lines.push("```");
    lines.push("");
  });
  lines.push("### Code scan limits", "");
  for (const item of CODE_SCAN_LIMITATIONS) lines.push(`- ${item}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}
