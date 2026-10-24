import { ReportView } from "@/components/ReportView";
import { badgeLabel, isScanStale, renderBadgeSvg } from "@/lib/badge";
import { buildDemoReport } from "@/lib/demo-report";

export const metadata = { title: "Sample report" };

export default function DemoReportPage() {
  const report = buildDemoReport();
  const fresh = { score: 96, finishedAt: new Date("2026-10-20T00:00:00.000Z"), passed: true, stale: false };
  const stale = { score: 96, finishedAt: new Date("2026-08-01T00:00:00.000Z"), passed: true, stale: isScanStale(new Date("2026-08-01T00:00:00.000Z"), new Date("2026-10-24T00:00:00.000Z"), 30) };
  return (
    <div className="space-y-8 py-6">
      <p className="max-w-2xl text-[#d9d3c5]">
        This page is sample data so the report UI can be reviewed without a live target. It is not the result of a scan in this environment. Real scans require ownership proof and consent.
      </p>
      <div className="flex flex-wrap gap-4">
        <BadgePreview model={fresh} caption={badgeLabel(fresh)} />
        <BadgePreview model={stale} caption={badgeLabel({ ...stale, stale: true })} />
      </div>
      <ReportView report={report} targetLabel="Sample application" sample />
    </div>
  );
}

function BadgePreview({
  model,
  caption,
}: {
  model: { score: number; finishedAt: Date; passed: boolean; stale: boolean };
  caption: string;
}) {
  const svg = renderBadgeSvg(model);
  return (
    <figure>
      <img alt={caption} src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} />
      <figcaption className="mt-1 text-xs text-[#b7b1a4]">{caption}. Public badges show the score and date only.</figcaption>
    </figure>
  );
}
