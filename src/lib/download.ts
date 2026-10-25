import { POINT_IN_TIME_DISCLAIMER, formatScanDate } from "./badge";
import { SEVERITIES } from "./catalog";
import type { CustomerFinding, CustomerReport } from "./report";
import { containsToolBrand } from "./sanitize";
import { toolBrandPattern } from "./tool-denylist";

export function downloadAccess(input: {
  userId: string | null;
  scan: { userId: string; reportAccess: string; status: string } | null;
}): { ok: true } | { ok: false; status: 401 | 403 | 404 } {
  if (!input.userId) return { ok: false, status: 401 };
  if (!input.scan) return { ok: false, status: 404 };
  if (input.scan.userId !== input.userId) return { ok: false, status: 403 };
  if (input.scan.status !== "completed" || input.scan.reportAccess !== "full") return { ok: false, status: 403 };
  return { ok: true };
}

export function orderedFindings(report: CustomerReport): CustomerFinding[] {
  const seen = new Set<string>();
  const ordered: CustomerFinding[] = [];
  const groups = [...report.priority, ...report.families.flatMap((group) => group.findings)];
  for (const finding of groups) {
    if (seen.has(finding.checkId)) continue;
    seen.add(finding.checkId);
    ordered.push(finding);
  }
  return ordered;
}

export function downloadBasename(targetUrl: string, finishedAt: Date | null): string {
  let host = "scan";
  try {
    host = new URL(targetUrl).host;
  } catch {
    host = "scan";
  }
  const safeHost = host.replace(/[^a-zA-Z0-9.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "scan";
  const day = (finishedAt ?? new Date()).toISOString().slice(0, 10);
  return `vibecheck-${safeHost}-${day}`;
}

export function renderFixMarkdown(report: CustomerReport, targetUrl: string): string {
  const when = report.finishedAt ? formatScanDate(new Date(report.finishedAt)) : "an unknown date";
  const host = safeHostLabel(targetUrl);
  const lines: string[] = [
    "Fix these security issues in my app.",
    "",
    `VibeCheck scanned \`${host}\` on ${when}. VibeCheck score: ${report.score ?? "—"}. ${report.disclaimer}`,
    "",
    "Apply each fix in the application. Keep secrets on the server. The values below are already redacted.",
    "",
  ];
  const findings = orderedFindings(report);
  if (findings.length === 0) {
    lines.push("No findings were recorded for this scan.");
  }
  findings.forEach((finding, index) => {
    lines.push(`## ${index + 1}. ${finding.title}`);
    lines.push("");
    lines.push(`- Severity: ${finding.severity}`);
    lines.push(`- Family: ${finding.familyLabel}`);
    lines.push("");
    lines.push("### Location");
    lines.push("");
    lines.push(...locationLines(finding));
    lines.push("");
    lines.push("### Proof");
    lines.push("");
    lines.push(...proofLines(finding));
    lines.push("");
    if (finding.steps && finding.steps.length > 0) {
      lines.push("### Steps to reproduce");
      lines.push("");
      finding.steps.forEach((step, stepIndex) => lines.push(`${stepIndex + 1}. ${step}`));
      lines.push("");
    }
    lines.push("### Impact");
    lines.push("");
    lines.push(finding.impact);
    lines.push("");
    lines.push("### Fix");
    lines.push("");
    lines.push(fence(finding.fix));
    lines.push("");
  });
  return scrubTools(lines.join("\n").trim() + "\n");
}

export function renderPrintHtml(report: CustomerReport, targetUrl: string): string {
  const when = report.finishedAt ? formatScanDate(new Date(report.finishedAt)) : "Unknown date";
  const findings = orderedFindings(report);
  const counts = SEVERITIES.map(
    (severity) => `<li><strong>${report.severityCounts[severity] ?? 0}</strong><span>${escapeHtml(severity)}</span></li>`,
  ).join("");
  const blocks = findings
    .map((finding) => {
      const places = (finding.locations ?? [])
        .map((location) => {
          const extra = [
            location.line ? `line ${location.line}` : "",
            location.column ? `column ${location.column}` : "",
            location.maskedSecret ? `secret ${location.maskedSecret}` : "",
          ].filter(Boolean);
          return `<li><span class="method">${escapeHtml(location.method)}</span> ${escapeHtml(location.url)}${extra.length ? ` <span class="meta">(${escapeHtml(extra.join(", "))})</span>` : ""}</li>`;
        })
        .join("");
      const headers = (finding.proof?.headers ?? [])
        .map((header) => `<li>${escapeHtml(header.name)}: ${escapeHtml(header.value)}</li>`)
        .join("");
      const steps = (finding.steps ?? []).map((step) => `<li>${escapeHtml(step)}</li>`).join("");
      return `<section class="finding">
        <p class="kicker">${escapeHtml(finding.severity)} · ${escapeHtml(finding.familyLabel)}</p>
        <h2>${escapeHtml(finding.title)}</h2>
        <h3>Location</h3>
        <ul>${places || "<li>No request URL was recorded.</li>"}</ul>
        <h3>Proof</h3>
        <p>${finding.proof ? `Request: ${escapeHtml(finding.proof.method)} ${escapeHtml(finding.proof.url)}` : "No request was recorded."}</p>
        ${headers ? `<ul class="headers">${headers}</ul>` : ""}
        ${finding.proof ? `<pre>${escapeHtml(finding.proof.responseSnippet)}</pre>` : ""}
        <h3>Steps to reproduce</h3>
        <ol>${steps || "<li>No steps were recorded.</li>"}</ol>
        <h3>Impact</h3>
        <p>${escapeHtml(finding.impact)}</p>
        <h3>Fix</h3>
        <pre>${escapeHtml(finding.fix)}</pre>
      </section>`;
    })
    .join("\n");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(downloadBasename(targetUrl, report.finishedAt ? new Date(report.finishedAt) : null))}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #14201b; background: #fff; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12.5px; line-height: 1.5; }
    .cover { padding: 8px 0 12px; }
    .brand { display: flex; align-items: center; gap: 10px; font-family: Georgia, serif; font-size: 22px; font-weight: 700; }
    .mark { display: inline-grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; background: #dff25b; color: #14201b; font-size: 14px; }
    .score { margin: 18px 0 0; font-family: Georgia, serif; font-size: 64px; line-height: 0.9; }
    .label { margin: 6px 0 0; color: #3d453f; }
    .meta-line { margin: 4px 0; }
    .counts { display: flex; gap: 8px; margin: 16px 0; padding: 0; list-style: none; }
    .counts li { flex: 1; border-radius: 12px; background: #f4f0e6; padding: 8px; text-align: center; text-transform: uppercase; font-size: 10px; }
    .counts strong { display: block; font-family: Georgia, serif; font-size: 22px; font-weight: 700; text-transform: none; }
    .disclaimer { color: #536058; font-size: 11px; }
    .finding { break-before: page; page-break-before: always; }
    h2 { font-family: Georgia, serif; font-size: 22px; margin: 0 0 8px; }
    h3 { margin: 14px 0 4px; font-size: 13px; }
    .kicker { margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.08em; font-size: 10px; color: #5c675f; }
    .method { font-weight: 700; }
    .meta { color: #3d453f; }
    ul, ol { margin: 4px 0 0; padding-left: 18px; }
    pre {
      margin: 8px 0 0;
      padding: 12px;
      border-radius: 12px;
      background: #14201b;
      color: #f4f0e6;
      -webkit-text-fill-color: #f4f0e6;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      line-height: 1.45;
    }
  </style>
</head>
<body>
  <article class="cover" data-report="vibecheck-print">
    <div class="brand"><span class="mark">VC</span> VibeCheck</div>
    <p class="score">${report.score ?? "—"}</p>
    <p class="label">${report.passed ? "Passed VibeCheck" : "VibeCheck score"} · ${report.totalFindings} finding${report.totalFindings === 1 ? "" : "s"}</p>
    <p class="meta-line"><strong>Target.</strong> ${escapeHtml(targetUrl)}</p>
    <p class="meta-line"><strong>Scanned.</strong> ${escapeHtml(when)}</p>
    <ul class="counts">${counts}</ul>
    <p class="disclaimer">${escapeHtml(report.disclaimer || POINT_IN_TIME_DISCLAIMER)}</p>
  </article>
  ${blocks || `<section class="finding"><h2>No findings</h2><p>This scan did not record a finding.</p></section>`}
</body>
</html>`;
  return scrubTools(html);
}

export function pdfHeaderTemplate(): string {
  return `<div style="width:100%; font-size:9px; padding:0 12mm; color:#14201b; font-family: Georgia, serif;">VibeCheck</div>`;
}

export function pdfFooterTemplate(disclaimer = POINT_IN_TIME_DISCLAIMER): string {
  return `<div style="width:100%; font-size:8px; color:#3d453f; padding:0 12mm; font-family: ui-sans-serif, system-ui, sans-serif;">
    <div style="display:flex; justify-content:space-between; gap:16px; align-items:flex-end;">
      <div style="flex:1;">${escapeHtml(disclaimer)}</div>
      <div style="white-space:nowrap;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>
    </div>
  </div>`;
}

function locationLines(finding: CustomerFinding): string[] {
  if (!finding.locations || finding.locations.length === 0) return ["- No request URL was recorded."];
  return finding.locations.map((location) => {
    const extra = [
      location.line ? `line ${location.line}` : "",
      location.column ? `column ${location.column}` : "",
      location.maskedSecret ? `secret ${location.maskedSecret}` : "",
    ].filter(Boolean);
    const suffix = extra.length ? ` (${extra.join(", ")})` : "";
    return `- ${location.method} ${location.url}${suffix}`;
  });
}

function proofLines(finding: CustomerFinding): string[] {
  if (!finding.proof) return ["No request was recorded."];
  const lines = [`Request: ${finding.proof.method} ${finding.proof.url}`, ""];
  if (finding.proof.headers.length > 0) {
    lines.push("Headers:");
    lines.push("");
    for (const header of finding.proof.headers) lines.push(`- ${header.name}: ${header.value}`);
    lines.push("");
  }
  lines.push("Response:", "");
  lines.push(fence(finding.proof.responseSnippet));
  return lines;
}

function fence(code: string): string {
  const body = code || "";
  const marker = body.includes("```") ? "````" : "```";
  return `${marker}\n${body}\n${marker}`;
}

function safeHostLabel(targetUrl: string): string {
  try {
    return new URL(targetUrl).host;
  } catch {
    return targetUrl;
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function scrubTools(input: string): string {
  if (!containsToolBrand(input)) return input;
  return input.replace(toolBrandPattern(), "automated check");
}
