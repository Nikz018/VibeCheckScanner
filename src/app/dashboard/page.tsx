import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CancelSubscription } from "@/components/CancelSubscription";
import { ScoreGauge } from "@/components/ScoreGauge";
import { ScoreRings, UnavailableScoreRings } from "@/components/ScoreRings";
import { codeScoreGap, combinedScores } from "@/lib/code-scan/score";
import { parseCodeReport } from "@/lib/code-scan/parse";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SEVERITIES } from "@/lib/catalog";
import { monitoringActive, ownedScanAccess } from "@/lib/entitlements";
import { formatSeverityBreakdown, readSeverityCounts, reportBadge } from "@/lib/report";
import { AWAITING_REPO_STATUS } from "@/lib/code-scan/gate";
import { CONNECT_GITHUB_CODE_SCAN_LABEL, codeScanDashboardPrompt, paidScanDashboardAction } from "@/lib/payments/paid-scan-status";
import { codeScanFailurePrompt, codeScanRepoLabel } from "@/lib/code-scan/messages";
import { codeScanRepoName } from "@/lib/code-scan/repo-lock";
import { githubAppConfig } from "@/lib/github/app";
import { UPGRADE_ACTIONS } from "@/lib/pricing";
import { privateMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";
export const metadata: Metadata = privateMetadata("Dashboard");

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard");
  const [projects, scans, alerts, purchases] = await Promise.all([
    prisma.project.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
    prisma.scan.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 20, include: { project: { include: { repoLink: true } } } }),
    prisma.alert.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.purchase.findMany({
      where: { userId: user.id, status: "paid", tier: { in: ["report", "rescan"] }, scanId: { not: null } },
      include: { fullScan: { select: { id: true, status: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const purchaseByPreview = new Map<string, (typeof purchases)[number]>();
  const paidScanIds = new Set<string>();
  for (const purchase of purchases) {
    if (purchase.scanId && !purchaseByPreview.has(purchase.scanId)) purchaseByPreview.set(purchase.scanId, purchase);
    if (purchase.scanId) paidScanIds.add(purchase.scanId);
    if (purchase.fullScanId) paidScanIds.add(purchase.fullScanId);
  }
  const subscribed = monitoringActive(user.subscription?.status);
  const githubReady = githubAppConfig() !== null;

  return (
    <div className="space-y-8 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl">Dashboard</h1>
          <p className="mt-2 text-sm text-[#c5d2e6]">{user.email}</p>
        </div>
        <div className="flex gap-3">
          <Link href="/scans/new" className="btn btn-lime">
            New scan
          </Link>
          <form action="/api/auth/logout" method="post">
            <button className="btn btn-ghost" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </div>
      <section className="grid gap-3 md:grid-cols-3">
        <article className="lift rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs uppercase tracking-wide text-[#c5d2e6]">Full-report credits</p>
          <p className="font-display text-4xl">{user.reportCredits}</p>
        </article>
        <article className="lift rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs uppercase tracking-wide text-[#c5d2e6]">Rescan credits</p>
          <p className="font-display text-4xl">{user.rescanCredits}</p>
        </article>
        <article className="lift rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs uppercase tracking-wide text-[#c5d2e6]">Monitoring</p>
          <p className="font-display text-4xl">{subscribed ? "On" : "Off"}</p>
          {subscribed && (user.subscription?.dodoSubscriptionId || user.subscription?.stripeSubscriptionId) ? <CancelSubscription /> : null}
        </article>
      </section>
      {alerts.length > 0 ? (
        <section>
          <h2 className="font-display text-3xl">Alerts</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {alerts.map((alert) => (
              <li key={alert.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                {alert.message}{" "}
                <Link className="underline" href={`/scans/${alert.scanId}`}>
                  Open scan
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section>
        <h2 className="font-display text-3xl">Recent scans</h2>
        <ul className="mt-3 space-y-3">
          {scans.length === 0 ? <li className="py-4 text-sm text-[#c5d2e6]">No scans yet.</li> : null}
          {scans.map((scan) => {
            const access = ownedScanAccess({
              mode: scan.mode,
              reportAccess: scan.reportAccess,
              subscriber: subscribed,
              purchased: paidScanIds.has(scan.id),
            });
            const previewPurchase = scan.mode === "mini" ? purchaseByPreview.get(scan.id) ?? null : null;
            const linkedPurchase = previewPurchase ?? purchases.find((row) => row.fullScanId === scan.id) ?? null;
            const repoConnected = Boolean(scan.project.repoLink?.status === "connected" && scan.project.repoLink.owner && scan.project.repoLink.name);
            const codeRepo =
              codeScanRepoName(scan.codeRepoOwner, scan.codeRepoName) ??
              (scan.codeScanEnabled && scan.codeScanChoice !== "skip" && repoConnected && scan.project.repoLink
                ? `${scan.project.repoLink.owner}/${scan.project.repoLink.name}`
                : null);
            const rawAction = scan.mode === "mini"
              ? paidScanDashboardAction(
                  scan.id,
                  previewPurchase
                    ? {
                        status: previewPurchase.status,
                        ownershipBlock: previewPurchase.ownershipBlock,
                        startNote: previewPurchase.startNote,
                        fullScan: previewPurchase.fullScan,
                        tier: previewPurchase.tier,
                        repoConnected,
                        githubConfigured: githubReady,
                      }
                    : null,
                  UPGRADE_ACTIONS.report,
                )
              : null;
            const prompt = codeScanDashboardPrompt({
              tier: linkedPurchase?.tier,
              repoConnected,
              githubConfigured: githubReady,
              previewId: linkedPurchase?.scanId ?? (scan.mode === "mini" ? scan.id : null),
              projectId: scan.projectId,
              fullScan: linkedPurchase?.fullScan ?? (linkedPurchase && scan.mode === "full" ? { id: scan.id, status: scan.status } : null),
            });
            const showPrompt = Boolean(prompt && prompt.label !== rawAction?.label && scan.status !== AWAITING_REPO_STATUS);
            const pricingAction = rawAction?.label === UPGRADE_ACTIONS.report || rawAction?.label === UPGRADE_ACTIONS.rescan;
            const action = rawAction && (!pricingAction || access.upsell) ? rawAction : null;
            const codeReport = scan.codeScanEnabled ? parseCodeReport(scan.codeReport) : null;
            const scoreInput = {
              codeScanEnabled: scan.codeScanEnabled,
              siteScore: scan.score,
              codeReport,
              repoConnected,
              scanStatus: scan.status,
            };
            const scores = combinedScores(scoreInput);
            const codeGap = codeScoreGap(scoreInput);
            const codeFailure = codeScanFailurePrompt({
              scanId: scan.id,
              scanStatus: scan.status,
              repoConnected,
              report: codeReport,
            });
            const counts = readSeverityCounts(scan.severityCounts);
            const total = counts ? SEVERITIES.reduce((sum, severity) => sum + counts[severity], 0) : null;
            const breakdown = counts ? formatSeverityBreakdown(counts) : "";
            return (
              <li key={scan.id} className="lift flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
                <div className="flex items-center gap-3">
                  {scores ? (
                    <ScoreRings scores={scores} tone="dark" layout="dashboard" />
                  ) : codeGap ? (
                    <UnavailableScoreRings gap={codeGap} tone="dark" layout="dashboard" />
                  ) : (
                    <ScoreGauge score={scan.score} size="sm" tone="dark" showExplainer={false} />
                  )}
                  <div>
                    <Link href={`/scans/${scan.id}`} className="font-semibold underline">
                      {scan.project.url}
                    </Link>
                    <p className="text-[#c5d2e6]">
                      {reportBadge({ upsell: access.upsell })} · {scan.status === AWAITING_REPO_STATUS ? "waiting for a repository" : scan.status}
                      {scan.scheduled ? " · scheduled" : ""}
                    </p>
                    {codeRepo ? <p className="text-[#c5d2e6]">{codeScanRepoLabel(codeRepo)}</p> : null}
                    {scan.status === "completed" && total === 0 ? <p className="text-[#c5d2e6]">No findings</p> : null}
                    {scan.status === "completed" && total !== null && total > 0 ? (
                      <p className="text-[#c5d2e6]">
                        {total} finding{total === 1 ? "" : "s"}
                        {breakdown ? ` · ${breakdown}` : ""}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {scan.status === AWAITING_REPO_STATUS ? (
                    <Link href={`/scans/${scan.id}#code-scan-step`} className="font-semibold text-lime underline">
                      {codeRepo ? "Choose the code scan repo" : CONNECT_GITHUB_CODE_SCAN_LABEL}
                    </Link>
                  ) : null}
                  {codeFailure ? (
                    <Link href={codeFailure.href} className="font-semibold text-lime underline">
                      {codeFailure.label}
                    </Link>
                  ) : null}
                  {showPrompt && prompt ? (
                    <Link href={prompt.href} className="font-semibold text-lime underline">
                      {prompt.label}
                    </Link>
                  ) : null}
                  {action ? (
                    <Link href={action.href} className="btn btn-lime px-3 py-1.5 text-sm">
                      {action.label}
                    </Link>
                  ) : null}
                  <span className="text-[#c5d2e6]">{scan.createdAt.toISOString().slice(0, 10)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <section>
        <h2 className="font-display text-3xl">Origins</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {projects.map((project) => (
            <li key={project.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
              {project.url} · {project.ownershipVerifiedAt ? "ownership verified" : "ownership not verified"}
              {project.monitorEnabled ? " · monitoring armed" : ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
