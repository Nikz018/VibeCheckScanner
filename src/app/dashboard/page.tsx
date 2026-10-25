import Link from "next/link";
import { redirect } from "next/navigation";
import { CancelSubscription } from "@/components/CancelSubscription";
import { ScoreGauge } from "@/components/ScoreGauge";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { monitoringActive } from "@/lib/entitlements";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard");
  const [projects, scans, alerts] = await Promise.all([
    prisma.project.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
    prisma.scan.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 20, include: { project: true } }),
    prisma.alert.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const subscribed = monitoringActive(user.subscription?.status);

  return (
    <div className="space-y-8 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl">Dashboard</h1>
          <p className="mt-2 text-sm text-[#d9d3c5]">{user.email}</p>
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
        <article className="rounded-2xl border border-white/10 p-4">
          <p className="text-xs uppercase tracking-wide text-[#b7b1a4]">Full-report credits</p>
          <p className="font-display text-4xl">{user.reportCredits}</p>
        </article>
        <article className="rounded-2xl border border-white/10 p-4">
          <p className="text-xs uppercase tracking-wide text-[#b7b1a4]">Rescan credits</p>
          <p className="font-display text-4xl">{user.rescanCredits}</p>
        </article>
        <article className="rounded-2xl border border-white/10 p-4">
          <p className="text-xs uppercase tracking-wide text-[#b7b1a4]">Monitoring</p>
          <p className="font-display text-4xl">{subscribed ? "On" : "Off"}</p>
          {subscribed && (user.subscription?.dodoSubscriptionId || user.subscription?.stripeSubscriptionId) ? <CancelSubscription /> : null}
        </article>
      </section>
      {alerts.length > 0 ? (
        <section>
          <h2 className="font-display text-3xl">Alerts</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {alerts.map((alert) => (
              <li key={alert.id} className="rounded-2xl border border-white/10 p-3">
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
        <ul className="mt-3 divide-y divide-white/10">
          {scans.length === 0 ? <li className="py-4 text-sm text-[#c9c2b2]">No scans yet.</li> : null}
          {scans.map((scan) => (
            <li key={scan.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div className="flex items-center gap-3">
                <ScoreGauge score={scan.score} size="sm" tone="dark" />
                <div>
                  <Link href={`/scans/${scan.id}`} className="font-semibold underline">
                    {scan.project.url}
                  </Link>
                  <p className="text-[#b7b1a4]">
                    {scan.mode} · {scan.status} · {scan.reportAccess}
                    {scan.scheduled ? " · scheduled" : ""}
                  </p>
                </div>
              </div>
              <span className="text-[#b7b1a4]">{scan.createdAt.toISOString().slice(0, 10)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="font-display text-3xl">Origins</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {projects.map((project) => (
            <li key={project.id} className="rounded-2xl border border-white/10 p-3">
              {project.url} · {project.ownershipVerifiedAt ? "ownership verified" : "ownership not verified"}
              {project.monitorEnabled ? " · monitoring armed" : ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
