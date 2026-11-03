import type { CodeScanReport } from "@/lib/code-scan/types";
import { CODE_SCAN_EMPTY_NOTICE, CODE_SCAN_FAILED_TITLE, CODE_SCAN_RETRY_LABEL, CODE_SCAN_RETRY_NOTE } from "@/lib/code-scan/messages";
import { owaspStatusLabel } from "@/lib/code-scan/owasp";
import { CODE_PRIVACY_PROMISE, CODE_SCAN_LIMITATIONS, OWASP_ALIGNMENT } from "@/lib/code-scan/privacy";
import { CodeScanRefresh } from "./CodeScanRefresh";
import { RunCodeScanButton } from "./RunCodeScanButton";

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-[#f3c7bc] text-[#6e2414]",
  high: "bg-[#f8d7a8] text-[#6a3d09]",
  medium: "bg-[#f3e7a2] text-[#5c4a10]",
  low: "bg-[#e4e0d4] text-[#3d453f]",
  info: "bg-[#e7eee8] text-[#24503a]",
};

export function CodeScanPanel({
  scanId,
  projectId,
  report,
  repo,
  ownershipVerified,
  githubReady,
}: {
  scanId: string;
  projectId: string;
  report: CodeScanReport | null;
  repo: string | null;
  ownershipVerified: boolean;
  githubReady: boolean;
}) {
  const status = report?.status ?? (repo ? "failed" : "not_connected");
  const empty = Boolean(report?.empty);
  return (
    <section id="code-scan" className="panel p-5">
      <h2 className="font-display text-3xl">Code scan</h2>
      <p className="mt-3 rounded-2xl bg-[#dff25b]/15 px-4 py-3 text-sm text-[#e7f6c8]">{CODE_PRIVACY_PROMISE}</p>
      <CodeScanRefresh scanId={scanId} status={status} />
      {repo ? <p className="mt-3 text-sm text-[#d5deee]">Repository: {repo}</p> : null}
      {report?.commit ? <p className="mt-1 text-sm text-[#d5deee]">Commit: {report.commit.slice(0, 12)}</p> : null}
      {status === "not_connected" || !repo ? (
        <div className="mt-4 space-y-3 text-sm text-[#d5deee]">
          <p>Connect one repository you control. The connection can read that repository and nothing else. It also shows you control the code for this verified origin.</p>
          {ownershipVerified && githubReady ? (
            <a className="btn btn-lime" href={`/api/github/connect?projectId=${projectId}`}>
              Connect GitHub
            </a>
          ) : (
            <p>{githubReady ? "Verify ownership of this origin before connecting a repository." : "Repository connection is not available on this server yet."}</p>
          )}
        </div>
      ) : null}
      {status === "failed" ? (
        <div className="mt-4 space-y-3">
          <h3 className="font-display text-2xl">{CODE_SCAN_FAILED_TITLE}</h3>
          <p className="text-sm text-[#d5deee]">{CODE_SCAN_RETRY_NOTE}</p>
          <RunCodeScanButton projectId={projectId} label={CODE_SCAN_RETRY_LABEL} />
        </div>
      ) : null}
      {empty ? (
        <div className="mt-4 space-y-3">
          <h3 className="font-display text-2xl">{CODE_SCAN_EMPTY_NOTICE}</h3>
          <p className="text-sm text-[#d5deee]">{CODE_SCAN_RETRY_NOTE}</p>
          <RunCodeScanButton projectId={projectId} label={CODE_SCAN_RETRY_LABEL} />
        </div>
      ) : null}
      {repo && (status === "skipped" || status === "not_connected") ? (
        <div className="mt-4">
          <RunCodeScanButton projectId={projectId} />
        </div>
      ) : null}
      {status === "queued" || status === "running" ? <p className="mt-4 text-sm text-[#d5deee]">The code scan is running. This page refreshes when it finishes.</p> : null}
      {report?.notices
        .filter((notice) => notice !== CODE_SCAN_EMPTY_NOTICE)
        .map((notice) => (
          <p key={notice} className="mt-3 text-sm text-[#d5deee]">
            {notice}
          </p>
        ))}
      {status === "completed" && report && !empty ? (
        <>
          <h3 className="mt-6 font-display text-2xl">OWASP Top 10 coverage</h3>
          <p className="mt-2 text-sm text-[#d5deee]">{OWASP_ALIGNMENT}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {report.owasp.map((row) => (
              <article key={row.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <p className="text-sm font-semibold">
                  {row.id} {row.name}
                </p>
                <p className="mt-1 text-sm capitalize text-[#d5deee]">
                  {owaspStatusLabel(row.status)}
                  {row.findingCount > 0 ? ` · ${row.findingCount}` : ""}
                </p>
              </article>
            ))}
          </div>
          <h3 className="mt-6 font-display text-2xl">Findings</h3>
          {report.findings.length === 0 ? <p className="mt-2 text-sm text-[#d5deee]">No issues in the files this scan read.</p> : null}
          <div className="mt-3 space-y-4">
            {report.findings.map((finding) => (
              <article key={`${finding.ruleId}-${finding.file}-${finding.line}`} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded-full px-2 py-1 font-semibold uppercase ${SEVERITY_STYLE[finding.severity] ?? SEVERITY_STYLE.info}`}>{finding.severity}</span>
                  <span className="text-[#c5d2e6]">{finding.family}</span>
                  <span className="text-[#c5d2e6]">{finding.owasp}</span>
                </div>
                <h4 className="mt-2 font-display text-2xl">{finding.title}</h4>
                <p className="mt-2 text-sm text-[#d5deee]">
                  {finding.file}:{finding.line}
                </p>
                <p className="mt-2 text-sm leading-6 text-[#e4ebf6]">{finding.explanation}</p>
                {finding.snippet ? <pre className="mt-3 overflow-x-auto rounded-xl bg-[#0c1422] p-3 text-xs text-[#e4ebf6]">{finding.snippet}</pre> : null}
                <p className="mt-3 text-xs uppercase tracking-wide text-[#c5d2e6]">Fix prompt</p>
                <pre className="mt-1 whitespace-pre-wrap rounded-xl bg-[#0c1422] p-3 text-xs text-[#e4ebf6]">{finding.fixPrompt}</pre>
              </article>
            ))}
          </div>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-[#d5deee]">
            {CODE_SCAN_LIMITATIONS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
