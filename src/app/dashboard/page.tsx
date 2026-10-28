import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CancelSubscription } from "@/components/CancelSubscription";
import { ScoreGauge } from "@/components/ScoreGauge";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SEVERITIES } from "@/lib/catalog";
import { monitoringActive, ownedScanAccess } from "@/lib/entitlements";
import { formatSeverityBreakdown, readSeverityCounts, reportBadge } from "@/lib/report";
import { paidScanDashboardAction } from "@/lib/payments/paid-scan-status";
import { UPGRADE_ACTIONS } from "@/lib/pricing";
import { privateMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";
export const metadata: Metadata = privateMetadata("Dashboard");

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard");
  const [projects, scans, alerts, purchases] = await Promise.all([
    prisma.project.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
    prisma.scan.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 20, include: { project: true } }),
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
            const rawAction = scan.mode === "mini" ? paidScanDashboardAction(scan.id, purchaseByPreview.get(scan.id) ?? null, UPGRADE_ACTIONS.report) : null;
            const pricingAction = rawAction?.label === UPGRADE_ACTIONS.report || rawAction?.label === UPGRADE_ACTIONS.rescan;
            const action = rawAction && (!pricingAction || access.upsell) ? rawAction : null;
            const counts = readSeverityCounts(scan.severityCounts);
            const total = counts ? SEVERITIES.reduce((sum, severity) => sum + counts[severity], 0) : null;
            const breakdown = counts ? formatSeverityBreakdown(counts) : "";
            return (
              <li key={scan.id} className="lift flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
                <div className="flex items-center gap-3">
                  <ScoreGauge score={scan.score} size="sm" tone="dark" showExplainer={false} />
                  <div>
                    <Link href={`/scans/${scan.id}`} className="font-semibold underline">
                      {scan.project.url}
                    </Link>
                    <p className="text-[#c5d2e6]">
                      {reportBadge({ upsell: access.upsell })} · {scan.status}
                      {scan.scheduled ? " · scheduled" : ""}
                    </p>
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
