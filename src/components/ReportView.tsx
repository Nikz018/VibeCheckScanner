import type { CustomerReport } from "@/lib/report";
import type { Severity } from "@/lib/catalog";
import { UpgradePanel } from "./UpgradePanel";
import { SharePanel } from "./SharePanel";
import { MonitorToggle } from "./MonitorToggle";
import { ScoreGauge } from "./ScoreGauge";
import Link from "next/link";

const SEVERITY_STYLE: Record<Severity, string> = {
  critical: "bg-[#f3c7bc] text-[#6e2414]",
  high: "bg-[#f8d7a8] text-[#6a3d09]",
  medium: "bg-[#f3e7a2] text-[#5c4a10]",
  low: "bg-[#e4e0d4] text-[#3d453f]",
  info: "bg-[#e7eee8] text-[#24503a]",
};

export function ReportView({
  report,
  targetLabel,
  sample = false,
  scanId,
  share,
  project,
  collectBilling = false,
}: {
  report: CustomerReport;
  targetLabel?: string;
  sample?: boolean;
  scanId?: string;
  share?: { enabled: boolean; token: string | null };
  project?: { id: string; monitorEnabled: boolean; monitoringAllowed: boolean };
  collectBilling?: boolean;
}) {
  return (
    <div className="space-y-6">
      <section className="paper rounded-[28px] p-6 text-ink shadow-card md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-[#6d6758]">{sample ? "Sample report" : report.mode === "mini" ? "Mini check" : "Launch scan"}</p>
            <div className="mt-3">
              <ScoreGauge score={report.score} tone="light" />
            </div>
            <p className="mt-3 text-sm text-[#4c5a52]">
              {report.totalFindings} finding{report.totalFindings === 1 ? "" : "s"}
              {report.stale ? " · rescan needed" : ""}
            </p>
            {targetLabel ? <p className="mt-2 text-sm">Origin: {targetLabel}</p> : null}
            {report.access === "full" && scanId && !sample ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <a className="btn btn-lime" href={`/api/scans/${scanId}/pdf`}>
                  Download PDF
                </a>
                <a className="btn btn-ink" href={`/api/scans/${scanId}/markdown`}>
                  Download for AI fix (.md)
                </a>
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-5 gap-2 text-center text-xs">
            {Object.entries(report.severityCounts).map(([severity, count]) => (
              <div key={severity} className={`rounded-2xl px-3 py-2 ${SEVERITY_STYLE[severity as Severity]}`}>
                <div className="font-display text-2xl">{count}</div>
                {severity}
              </div>
            ))}
          </div>
        </div>
        {report.stale ? (
          <p className="mt-4 rounded-2xl bg-[#fff1c9] px-4 py-3 text-sm">This scan is more than 30 days old. The badge reads “rescan needed” until you run it again.</p>
        ) : null}
        <p className="mt-4 text-sm text-[#536058]">Score starts at 100. Critical −25, high −12, medium −6, low −2.</p>
        <p className="mt-2 text-sm text-[#536058]">{report.disclaimer}</p>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        {report.coverage.map((row) => (
          <article key={row.family} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <h2 className="text-sm font-semibold">{row.label}</h2>
            <p className="mt-2 font-display text-2xl capitalize">{row.status === "not_run" ? "Not run" : row.status === "incomplete" ? "Partial" : row.status === "error" ? "Not completed" : row.status === "pass" ? "No issues" : `${row.findingCount} finding${row.findingCount === 1 ? "" : "s"}`}</p>
            <p className="mt-1 text-xs text-[#c9c2b2]">
              {row.checksRun.length} checks ran{row.checksNotRun.length ? ` · ${row.checksNotRun.length} not included` : ""}
            </p>
          </article>
        ))}
      </section>

      {report.access === "teaser" ? (
        <section className="space-y-4">
          <h2 className="font-display text-3xl">Sample issues</h2>
          <div className="grid gap-4">
            {report.samples.map((finding) => (
              <FindingCard key={finding.checkId} finding={finding} paid={false} />
            ))}
          </div>
          <p className="text-sm text-[#d9d3c5]">{report.hiddenCount} more findings are hidden on the free teaser.</p>
          {scanId ? <UpgradePanel scanId={scanId} collectBilling={collectBilling} /> : null}
        </section>
      ) : (
        <>
          {report.priority.length > 0 ? (
            <section className="space-y-4">
              <h2 className="font-display text-3xl">Priority issues</h2>
              <div className="grid gap-4">
                {report.priority.map((finding) => (
                  <FindingCard key={finding.checkId} finding={finding} paid />
                ))}
              </div>
            </section>
          ) : (
            <p className="text-[#d9d3c5]">No headline issues on this scan.</p>
          )}
          {report.families.map((group) => (
            <section key={group.family} className="space-y-3">
              <h2 className="font-display text-2xl">{group.label}</h2>
              {group.findings
                .filter((finding) => finding.headlineRank === null)
                .map((finding) => (
                  <FindingCard key={finding.checkId} finding={finding} paid />
                ))}
              {group.findings.every((finding) => finding.headlineRank !== null) ? (
                <p className="text-sm text-[#c9c2b2]">Headline findings for this family are in the priority list above.</p>
              ) : null}
            </section>
          ))}
        </>
      )}

      {report.mode === "mini" ? (
        <div className="rounded-3xl border border-lime/40 bg-lime/10 p-5">
          <h3 className="font-display text-2xl">This was the mini check</h3>
          <p className="mt-2 text-sm text-[#d9d3c5]">Headers and public files ran. Supabase, Firebase, admin routes, and the rest of the launch scan did not. Coverage above marks those families as not run.</p>
          <Link href="/scans/new" className="btn btn-lime mt-4">
            Run a full launch scan
          </Link>
        </div>
      ) : null}

      {scanId && share ? <SharePanel scanId={scanId} enabled={share.enabled} token={share.token} /> : null}
      {project ? (
        <div className="paper rounded-3xl p-5 text-ink">
          <h3 className="font-display text-2xl">Continuous monitoring</h3>
          <p className="mb-3 mt-1 text-sm text-[#536058]">Scheduled rescans use the same ownership proof. If you remove the token, the next run stops.</p>
          <MonitorToggle projectId={project.id} enabled={project.monitorEnabled} allowed={project.monitoringAllowed} />
        </div>
      ) : null}
    </div>
  );
}

function FindingCard({ finding, paid }: { finding: CustomerReport["samples"][number]; paid: boolean }) {
  const showWhere = paid && reportHasWhere(finding);
  return (
    <article className="paper rounded-3xl p-5 text-ink">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-1 font-semibold uppercase ${SEVERITY_STYLE[finding.severity]}`}>{finding.severity}</span>
        <span className="text-[#5c675f]">{finding.familyLabel}</span>
        {finding.headlineRank ? <span className="text-[#5c675f]">Headline {finding.headlineRank}</span> : null}
      </div>
      <h3 className="mt-3 font-display text-2xl">{finding.title}</h3>
      <div className="mt-3 space-y-4 text-sm leading-6">
        {finding.evidence ? (
          <p>
            <span className="font-semibold">Evidence. </span>
            {finding.evidence}
          </p>
        ) : null}
        <p>
          <span className="font-semibold">Impact. </span>
          {finding.impact}
        </p>
        {showWhere && finding.locations ? (
          <div>
            <p className="font-semibold">Location.</p>
            <ul className="mt-1 space-y-2">
              {finding.locations.map((location) => (
                <li key={`${location.method} ${location.url} ${location.line ?? 0}`} className="rounded-2xl bg-white/70 px-3 py-2">
                  <p>
                    <span className="font-semibold">{location.method}</span> {location.url}
                  </p>
                  {location.line ? (
                    <p className="text-[#3d453f]">
                      Line {location.line}
                      {location.column ? `, column ${location.column}` : ""}
                    </p>
                  ) : null}
                  {location.maskedSecret ? <p className="text-[#3d453f]">Secret {location.maskedSecret}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {showWhere && finding.proof ? (
          <div>
            <p className="font-semibold">Proof.</p>
            <p className="mt-1">
              Request: {finding.proof.method} {finding.proof.url}
            </p>
            {finding.proof.headers.length > 0 ? (
              <ul className="mt-1 text-[#3d453f]">
                {finding.proof.headers.map((header) => (
                  <li key={header.name}>
                    {header.name}: {header.value}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mb-1 mt-2 font-semibold">Response.</p>
            <CodeBlock>{finding.proof.responseSnippet}</CodeBlock>
          </div>
        ) : null}
        {showWhere && finding.steps && finding.steps.length > 0 ? (
          <div>
            <p className="font-semibold">Steps to reproduce.</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              {finding.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        ) : null}
        {finding.fix ? (
          <div>
            <p className="font-semibold">Fix.</p>
            <CodeBlock>{finding.fix}</CodeBlock>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function reportHasWhere(finding: CustomerReport["samples"][number]): boolean {
  return Boolean(finding.locations?.length && finding.proof && finding.steps?.length);
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre
      className="code-block"
      style={{ backgroundColor: "#14201b", color: "#f4f0e6", WebkitTextFillColor: "#f4f0e6" }}
    >
      {children}
    </pre>
  );
}
