import { notFound } from "next/navigation";
import { ScoreGauge } from "@/components/ScoreGauge";
import { POINT_IN_TIME_DISCLAIMER, badgeLabel, formatScanDate, isScanStale, renderBadgeSvg } from "@/lib/badge";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const scan = await prisma.scan.findFirst({
    where: { shareToken: token, shareEnabled: true, status: "completed" },
    select: { score: true, finishedAt: true, passed: true },
  });
  if (!scan || scan.score === null || !scan.finishedAt) notFound();
  const stale = isScanStale(scan.finishedAt);
  const model = { score: scan.score, finishedAt: scan.finishedAt, passed: scan.passed, stale };
  const svg = renderBadgeSvg(model);
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <p className="text-xs uppercase tracking-[0.2em] text-lime">VibeCheck</p>
      <div className="mt-6 flex justify-center">
        <ScoreGauge score={scan.score} size="lg" tone="dark" />
      </div>
      <p className="mt-3 text-[#d9d3c5]">Scanned {formatScanDate(scan.finishedAt)}</p>
      {stale ? <p className="mt-4 rounded-2xl bg-[#fff1c9] px-4 py-3 text-sm text-ink">rescan needed — this result is more than 30 days old.</p> : null}
      <img className="mx-auto mt-6" alt={badgeLabel(model)} src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} />
      <p className="mt-8 text-sm text-[#c9c2b2]">{POINT_IN_TIME_DISCLAIMER}</p>
    </div>
  );
}
