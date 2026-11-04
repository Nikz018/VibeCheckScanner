import type { ReactNode } from "react";
import type { CodeScoreGap, CombinedScores } from "@/lib/code-scan/score";
import type { CodeFinding } from "@/lib/code-scan/types";
import { FREE_PREVIEW_BLUR_CAP, blurredSeverityLabels, listPaidFindings, lockedFindingsSummary, lockedSeverityCounts, type ListedFinding } from "@/lib/finding-order";
import type { CustomerReport } from "@/lib/report";
import { FREE_PREVIEW_LABEL, FULL_REPORT_PURCHASE_LEDE, RESCAN_PURCHASE_NOTE, describeFindingCounts, formatSeverityBreakdown, freePreviewFacts, freePreviewLines, reportBadge } from "@/lib/report";
import { SEVERITIES, type Severity } from "@/lib/catalog";
import { sanitizeCode, sanitizeCustomerText } from "@/lib/sanitize";
import { TAX_NOTE, TIERS, type TierId } from "@/lib/pricing";
import { PAYMENT_DECLINED_COPY, PAYMENT_TRY_AGAIN_LABEL } from "@/lib/payments/checkout-return";
import { RESCAN_CONFIRMING_DETAIL } from "@/lib/payments/paid-scan-status";
import { PaidScanFollowup, PaymentConfirming, type PaidScanFollowupState } from "./PaidScanFollowup";
import { UpgradePanel } from "./UpgradePanel";
import { SharePanel } from "./SharePanel";
import { MonitorToggle } from "./MonitorToggle";
import { ScoreGauge } from "./ScoreGauge";
import { ScoreRings, UnavailableScoreRings } from "./ScoreRings";
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
  paidFollowup = null,
  paymentNotice = null,
  paymentTier = "report",
  recheck = false,
  codeScan = null,
  scores = null,
  codeGap = null,
  findings = null,
  includesCode = false,
}: {
  report: CustomerReport;
  targetLabel?: string;
  sample?: boolean;
  scanId?: string;
  share?: { enabled: boolean; token: string | null };
  project?: { id: string; monitorEnabled: boolean; monitoringAllowed: boolean };
  collectBilling?: boolean;
  paidFollowup?: PaidScanFollowupState | null;
  paymentNotice?: "confirming" | "declined" | null;
  paymentTier?: TierId;
  recheck?: boolean;
  codeScan?: ReactNode;
  scores?: CombinedScores | null;
  codeGap?: CodeScoreGap | null;
  findings?: ListedFinding[] | null;
  includesCode?: boolean;
}) {
  const listed = findings ?? listPaidFindings(report, []);
  const counted = { counts: report.severityCounts, includesCode };
  const findingLabel = describeFindingCounts(counted.counts, { includesCode });

  return (
    <div className="space-y-6">
      <section className="panel panel-glow p-6 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <p className={report.upsell && !sample ? "inline-flex rounded-full bg-[#fff3c4] px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#5c4a10]" : "text-xs uppercase tracking-[0.18em] text-[#b7c6dc]"}>
              {reportBadge(report, sample)}
            </p>
            <div className="mt-3">
              {scores ? <ScoreRings scores={scores} tone="dark" /> : codeGap ? <UnavailableScoreRings gap={codeGap} tone="dark" /> : <ScoreGauge score={report.score} tone="dark" />}
            </div>
            <p className="mt-3 text-sm text-[#d5deee]">
              {findingLabel}
              {report.stale ? " · rescan needed" : ""}
            </p>
            {targetLabel ? <p className="mt-2 text-sm">Origin: {targetLabel}</p> : null}
            {report.pagesScanned !== null ? (
              <p className="mt-2 text-sm">Scanned {report.pagesScanned} {report.pagesScanned === 1 ? "page" : "pages"}.</p>
            ) : null}
            {!report.upsell && scanId && !sample ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <a className="btn btn-lime" href={`/api/scans/${scanId}/pdf`}>
                  Download PDF
                </a>
                <a className="btn btn-ghost" href={`/api/scans/${scanId}/markdown`}>
                  Download for AI fix (.md)
                </a>
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-5">
            {Object.entries(counted.counts).map(([severity, count]) => (
              <div key={severity} className={`rounded-2xl px-3 py-2 ${SEVERITY_STYLE[severity as Severity]}`}>
                <div className="font-display text-2xl">{count}</div>
                {severity}
              </div>
            ))}
          </div>
        </div>
        {report.stale ? (
          <p className="mt-4 rounded-2xl bg-[#fff1c9] px-4 py-3 text-sm text-ink">This scan is more than 30 days old. The badge reads “rescan needed” until you run it again.</p>
        ) : null}
        {scores || codeGap ? null : <p className="mt-4 text-sm text-[#c5d2e6]">Score starts at 100. Critical −25, high −12, medium −6, low −2.</p>}
        <p className="mt-2 text-sm text-[#c5d2e6]">{report.disclaimer}</p>
        {report.notices.map((notice) => (
          <p key={notice} className="mt-3 rounded-2xl bg-[#fff1c9] px-4 py-3 text-sm text-ink">
            {notice}
          </p>
        ))}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        {report.coverage.map((row) => (
          <article key={row.family} className="lift rounded-2xl border border-white/10 bg-white/5 p-4">
            <h2 className="text-sm font-semibold">{row.label}</h2>
            <p className="mt-2 font-display text-2xl capitalize">{coverageLabel(row)}</p>
            <p className="mt-1 text-xs text-[#c5d2e6]">
              {row.checksRun.length} checks ran{row.checksNotRun.length ? ` · ${row.checksNotRun.length} not included` : ""}
            </p>
          </article>
        ))}
      </section>

      {report.upsell ? (
        <FreeFindings report={report} findings={listed} scanId={scanId} collectBilling={collectBilling} />
      ) : (
        <section className="space-y-4">
          <h2 className="font-display text-3xl">Findings</h2>
          {listed.length === 0 ? <p className="text-[#d5deee]">No issues on this scan.</p> : null}
          <div className="grid gap-4">
            {listed.map((item, index) =>
              item.code ? (
                <CodeFindingCard key={`${item.tieBreak}-${index}`} finding={item.code} />
              ) : item.site ? (
                <FindingCard key={`${item.tieBreak}-${index}`} finding={item.site} showAffectedPages />
              ) : null,
            )}
          </div>
        </section>
      )}

      {report.upsell && report.mode === "mini" && !sample ? (
        <section id="upgrade" className="space-y-4">
          <div className="upgrade-panel p-5">
            <h2 className="font-display text-3xl">{FREE_PREVIEW_LABEL}</h2>
            <div className="mt-3 space-y-2 text-sm text-[#d5deee]">
              {freePreviewLines(previewFacts(report, listed.length)).map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
            {paidFollowup || paymentNotice ? null : (
              <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-[#d5deee]">
                <li>
                  {TIERS.report.priceLabel} {TIERS.report.name}. {FULL_REPORT_PURCHASE_LEDE} {TAX_NOTE}.
                </li>
                <li>
                  {TIERS.rescan.priceLabel} {TIERS.rescan.name}. {RESCAN_PURCHASE_NOTE} {TAX_NOTE}.
                </li>
                <li>
                  {TIERS.monitor.priceLabel} {TIERS.monitor.name}. Scheduled rescans while the subscription is active. {TAX_NOTE}.
                </li>
              </ul>
            )}
          </div>
          {paidFollowup ? (
            <PaidScanFollowup followup={paidFollowup} />
          ) : paymentNotice === "confirming" ? (
            <PaymentConfirming recheck={recheck} detail={paymentTier === "rescan" ? RESCAN_CONFIRMING_DETAIL : undefined} />
          ) : paymentNotice === "declined" && scanId ? (
            <div className="space-y-4">
              <section className="rounded-3xl border border-[#f3c7bc]/50 bg-[#f3c7bc]/10 p-5">
                <h2 className="font-display text-3xl">Payment didn't go through</h2>
                <p className="mt-3 text-sm text-[#d5deee]">{PAYMENT_DECLINED_COPY}</p>
              </section>
              <UpgradePanel
                scanId={scanId}
                collectBilling={collectBilling}
                tierIds={[paymentTier]}
                heading="Try again"
                lede="The free preview is still available."
                actionLabel={PAYMENT_TRY_AGAIN_LABEL}
              />
            </div>
          ) : scanId ? (
            <UpgradePanel scanId={scanId} collectBilling={collectBilling} heading="What the full report adds" lede={FULL_REPORT_PURCHASE_LEDE} />
          ) : null}
        </section>
      ) : !report.upsell && (paidFollowup || paymentNotice) && !sample ? (
        <section className="space-y-4">
          {paidFollowup ? <PaidScanFollowup followup={paidFollowup} /> : null}
          {paymentNotice === "confirming" ? <PaymentConfirming recheck={recheck} detail={paymentTier === "rescan" ? RESCAN_CONFIRMING_DETAIL : undefined} /> : null}
          {paymentNotice === "declined" ? (
            <section className="rounded-3xl border border-[#f3c7bc]/50 bg-[#f3c7bc]/10 p-5">
              <h2 className="font-display text-3xl">Payment didn't go through</h2>
              <p className="mt-3 text-sm text-[#d5deee]">{PAYMENT_DECLINED_COPY}</p>
            </section>
          ) : null}
        </section>
      ) : null}

      {codeScan}

      <section className="panel p-5">
        <h2 className="font-display text-3xl">{report.limitationsTitle}</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[#d5deee]">
          {report.limitations.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-[#d5deee]">{report.limitationsNote}</p>
      </section>

      {scanId && share ? <SharePanel scanId={scanId} enabled={share.enabled} token={share.token} /> : null}
      {project && (project.monitoringAllowed || report.upsell) ? (
        <div className="paper rounded-3xl p-5 text-ink">
          <h3 className="font-display text-2xl">Continuous monitoring</h3>
          <p className="mb-3 mt-1 text-sm text-[#3d4d44]">Scheduled rescans use the same ownership proof. If you remove the token, the next run stops.</p>
          <MonitorToggle projectId={project.id} enabled={project.monitorEnabled} allowed={project.monitoringAllowed} showPrice={report.upsell} />
        </div>
      ) : null}
    </div>
  );
}

function previewFacts(report: CustomerReport, shown: number) {
  const facts = freePreviewFacts(report);
  if (report.access === "teaser") facts.findingsShown = shown;
  return facts;
}

function FreeFindings({
  report,
  findings,
  scanId,
  collectBilling,
}: {
  report: CustomerReport;
  findings: ListedFinding[];
  scanId?: string;
  collectBilling: boolean;
}) {
  const breakdown = formatSeverityBreakdown(report.severityCounts);
  const lockedCounts = lockedSeverityCounts(report.severityCounts, findings[0] ?? null);
  const summary = lockedFindingsSummary(lockedCounts);
  const blurred = blurredSeverityLabels(lockedCounts, FREE_PREVIEW_BLUR_CAP);

  return (
    <section className="space-y-4" aria-labelledby="free-findings-heading">
      <h2 id="free-findings-heading" className="font-display text-3xl">
        Findings
      </h2>
      {report.totalFindings === 0 ? (
        <p className="text-sm text-[#d5deee]">This scan did not find any issues.</p>
      ) : (
        <p className="text-sm text-[#d5deee]">
          {report.totalFindings} finding{report.totalFindings === 1 ? "" : "s"}
          {breakdown ? `: ${breakdown}` : ""}. This preview shows the lowest-severity finding in full.
          {report.hiddenCount > 0
            ? ` The other ${report.hiddenCount} ${report.hiddenCount === 1 ? "is" : "are"} locked. Unlock them with the ${TIERS.report.priceLabel} report, the ${TIERS.rescan.priceLabel} site plus code scan, or ${TIERS.monitor.priceLabel} monitoring.`
            : " Nothing else was found."}
        </p>
      )}
      <div className="grid gap-4">
        {findings.map((item, index) =>
          item.code ? (
            <CodeFindingCard key={`${item.tieBreak}-${index}`} finding={item.code} />
          ) : item.site ? (
            <FindingCard key={`${item.tieBreak}-${index}`} finding={item.site} />
          ) : null,
        )}
      </div>
      {summary ? (
        <article className="panel p-5" aria-label="Locked findings">
          <p className="text-sm text-[#d5deee]">{summary}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {SEVERITIES.filter((severity) => (lockedCounts[severity] ?? 0) > 0).map((severity) => (
              <span key={severity} className={`rounded-full px-2 py-1 text-xs font-semibold uppercase ${SEVERITY_STYLE[severity]}`}>
                {lockedCounts[severity]} {severity}
              </span>
            ))}
          </div>
        </article>
      ) : null}
      {blurred.length > 0 ? (
        <ul className="grid gap-3" aria-hidden="true">
          {blurred.map((severity, index) => (
            <li key={`${severity}-${index}`} className="locked-row panel px-4 py-3">
              <span className={`rounded-full px-2 py-1 text-xs font-semibold uppercase ${SEVERITY_STYLE[severity]}`}>{severity}</span>
              <span className="locked-ghost" />
            </li>
          ))}
        </ul>
      ) : null}
      {scanId && report.mode !== "mini" ? <UpgradePanel id="upgrade" scanId={scanId} collectBilling={collectBilling} /> : null}
      {!scanId ? <PriceHint /> : null}
    </section>
  );
}

function PriceHint() {
  return (
    <div id="upgrade" className="upgrade-panel p-5">
      <h3 className="font-display text-2xl">Unlock every finding</h3>
      <p className="mt-2 text-sm text-[#d5deee]">This sample uses invented data. A scan you own uses the same free preview, then checkout for the full report.</p>
      <ul className="mt-4 grid gap-3 md:grid-cols-3">
        {Object.values(TIERS).map((tier) => (
          <li key={tier.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="font-display text-3xl text-lime">{tier.priceLabel}</p>
            <p className="font-semibold">{tier.name}</p>
            <p className="mt-1 text-xs text-[#c5d2e6]">{TAX_NOTE}</p>
          </li>
        ))}
      </ul>
      <Link href="/pricing" className="btn btn-lime mt-4">
        See pricing
      </Link>
    </div>
  );
}

function FindingCard({ finding, showAffectedPages = false }: { finding: CustomerReport["samples"][number]; showAffectedPages?: boolean }) {
  const showWhere = reportHasWhere(finding);
  const affected = showAffectedPages ? finding.affectedPages ?? [] : [];
  return (
    <article className="lift panel p-5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-1 font-semibold uppercase ${SEVERITY_STYLE[finding.severity]}`}>{finding.severity}</span>
        <SourceTag source="Site" />
        <span className="text-[#c5d2e6]">{finding.familyLabel}</span>
        {finding.headlineRank ? <span className="text-[#c5d2e6]">Headline {finding.headlineRank}</span> : null}
        {finding.confidence ? <span className="text-[#c5d2e6]">Confidence {finding.confidence}</span> : null}
      </div>
      <h3 className="mt-3 font-display text-2xl">{finding.title}</h3>
      <div className="mt-3 space-y-4 text-sm leading-6 text-[#e4ebf6]">
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
        {affected.length > 0 ? (
          <div>
            <p className="font-semibold">Affected pages.</p>
            <ul className="mt-1 space-y-1">
              {affected.map((page) => (
                <li key={page}>{page}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {showWhere && finding.locations ? (
          <div>
            <p className="font-semibold">Location.</p>
            <ul className="mt-1 space-y-2">
              {finding.locations.map((location) => (
                <li key={`${location.method} ${location.url} ${location.line ?? 0}`} className="rounded-2xl bg-white/5 px-3 py-2">
                  <p>
                    <span className="font-semibold">{location.method}</span> {location.url}
                  </p>
                  {location.line ? (
                    <p className="text-[#c5d2e6]">
                      Line {location.line}
                      {location.column ? `, column ${location.column}` : ""}
                    </p>
                  ) : null}
                  {location.maskedSecret ? <p className="text-[#c5d2e6]">Secret {location.maskedSecret}</p> : null}
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
              <ul className="mt-1 text-[#c5d2e6]">
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

function CodeFindingCard({ finding }: { finding: CodeFinding }) {
  return (
    <article className="lift panel p-5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-1 font-semibold uppercase ${SEVERITY_STYLE[finding.severity]}`}>{finding.severity}</span>
        <SourceTag source="Code" />
        <span className="text-[#c5d2e6]">{finding.family}</span>
        <span className="text-[#c5d2e6]">{finding.owasp}</span>
      </div>
      <h3 className="mt-3 font-display text-2xl">{sanitizeCustomerText(finding.title)}</h3>
      <div className="mt-3 space-y-4 text-sm leading-6 text-[#e4ebf6]">
        <p>
          {finding.file}:{finding.line}
        </p>
        <p>{sanitizeCustomerText(finding.explanation)}</p>
        {finding.snippet ? (
          <div>
            <p className="font-semibold">Excerpt.</p>
            <CodeBlock>{sanitizeCode(finding.snippet)}</CodeBlock>
          </div>
        ) : null}
        {finding.fixPrompt ? (
          <div>
            <p className="font-semibold">Fix.</p>
            <CodeBlock>{sanitizeCode(finding.fixPrompt)}</CodeBlock>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function SourceTag({ source }: { source: "Site" | "Code" }) {
  return <span className="rounded-full bg-white/10 px-2 py-1 font-semibold uppercase tracking-wide text-[#d5deee]">{source}</span>;
}

function coverageLabel(row: CustomerReport["coverage"][number]): string {
  if (row.status === "not_run") return "Not run";
  if (row.status === "incomplete") return "Partial";
  if (row.status === "error") return "Not completed";
  if (row.status === "skipped") return "Not signed in";
  if (row.status === "pass") return "No issues";
  return `${row.findingCount} finding${row.findingCount === 1 ? "" : "s"}`;
}

function reportHasWhere(finding: CustomerReport["samples"][number]): boolean {
  return Boolean(finding.locations?.length && finding.proof && finding.steps?.length);
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="code-block" style={{ backgroundColor: "#0b1220", color: "#f4f7fb", WebkitTextFillColor: "#f4f7fb" }}>
      {children}
    </pre>
  );
}
