import type { CodeScanReport } from "@/lib/code-scan/types";
import { CODE_SCAN_EMPTY_NOTICE, CODE_SCAN_FAILED_TITLE, CODE_SCAN_REPO_LOCK_NOTE, CODE_SCAN_RETRY_LABEL, CODE_SCAN_RETRY_NOTE, codeScanRepoLabel } from "@/lib/code-scan/messages";
import { owaspStatusLabel } from "@/lib/code-scan/owasp";
import { CODE_PRIVACY_PROMISE, CODE_SCAN_LIMITATIONS, OWASP_ALIGNMENT } from "@/lib/code-scan/privacy";
import { CodeScanRefresh } from "./CodeScanRefresh";
import { RunCodeScanButton } from "./RunCodeScanButton";

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
      <p className="mt-3 rounded-2xl bg-[#ff6a3d]/15 px-4 py-3 text-sm text-[#f8e6dc]">{CODE_PRIVACY_PROMISE}</p>
      <CodeScanRefresh scanId={scanId} status={status} />
      {repo ? <p className="mt-3 text-sm text-[#e6ddd6]">{codeScanRepoLabel(repo)}</p> : null}
      {repo ? <p className="mt-1 text-sm text-[#e6ddd6]">{CODE_SCAN_REPO_LOCK_NOTE}</p> : null}
      {report?.commit ? <p className="mt-1 text-sm text-[#e6ddd6]">Commit: {report.commit.slice(0, 12)}</p> : null}
      {status === "not_connected" || !repo ? (
        <div className="mt-4 space-y-3 text-sm text-[#e6ddd6]">
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
          <p className="text-sm text-[#e6ddd6]">{CODE_SCAN_RETRY_NOTE}</p>
          <RunCodeScanButton projectId={projectId} label={CODE_SCAN_RETRY_LABEL} />
        </div>
      ) : null}
      {empty ? (
        <div className="mt-4 space-y-3">
          <h3 className="font-display text-2xl">{CODE_SCAN_EMPTY_NOTICE}</h3>
          <p className="text-sm text-[#e6ddd6]">{CODE_SCAN_RETRY_NOTE}</p>
          <RunCodeScanButton projectId={projectId} label={CODE_SCAN_RETRY_LABEL} />
        </div>
      ) : null}
      {repo && (status === "skipped" || status === "not_connected") ? (
        <div className="mt-4">
          <RunCodeScanButton projectId={projectId} />
        </div>
      ) : null}
      {status === "queued" || status === "running" ? <p className="mt-4 text-sm text-[#e6ddd6]">The code scan is running. This page refreshes when it finishes.</p> : null}
      {report?.notices
        .filter((notice) => notice !== CODE_SCAN_EMPTY_NOTICE)
        .map((notice) => (
          <p key={notice} className="mt-3 text-sm text-[#e6ddd6]">
            {notice}
          </p>
        ))}
      {status === "completed" && report && !empty ? (
        <>
          <h3 className="mt-6 font-display text-2xl">OWASP Top 10 coverage</h3>
          <p className="mt-2 text-sm text-[#e6ddd6]">{OWASP_ALIGNMENT}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {report.owasp.map((row) => (
              <article key={row.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <p className="text-sm font-semibold">
                  {row.id} {row.name}
                </p>
                <p className="mt-1 text-sm capitalize text-[#e6ddd6]">
                  {owaspStatusLabel(row.status)}
                  {row.findingCount > 0 ? ` · ${row.findingCount}` : ""}
                </p>
              </article>
            ))}
          </div>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-[#e6ddd6]">
            {CODE_SCAN_LIMITATIONS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
