import type { Metadata } from "next";
import { Breadcrumbs, JsonLd } from "@/components/Marketing";
import { ReportView } from "@/components/ReportView";
import { badgeLabel, isScanStale, renderBadgeSvg } from "@/lib/badge";
import { buildDemoReport } from "@/lib/demo-report";
import { getPublicPage } from "@/lib/seo/content";
import { jsonLdForPage } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata("demo-report");

export default function DemoReportPage() {
  const page = getPublicPage("demo-report");
  const report = buildDemoReport();
  const freePreview = buildDemoReport(new Date("2026-10-24T12:00:00.000Z"), "teaser");
  const fresh = { score: 96, finishedAt: new Date("2026-10-20T00:00:00.000Z"), passed: true, stale: false };
  const stale = { score: 96, finishedAt: new Date("2026-08-01T00:00:00.000Z"), passed: true, stale: isScanStale(new Date("2026-08-01T00:00:00.000Z"), new Date("2026-10-24T00:00:00.000Z"), 30) };
  return (
    <div className="space-y-8 py-6">
      <Breadcrumbs id="demo-report" />
      <h1 className="font-display text-5xl leading-[1.05]">{page.h1}</h1>
      <p className="max-w-2xl text-[#d9d3c5]">{page.lede}</p>
      <JsonLd data={jsonLdForPage("demo-report")} />
      <div className="flex flex-wrap gap-4">
        <BadgePreview model={fresh} caption={badgeLabel(fresh)} />
        <BadgePreview model={stale} caption={badgeLabel({ ...stale, stale: true })} />
      </div>
      <section id="free-preview" className="space-y-4">
        <h2 className="font-display text-4xl">Free preview of this sample</h2>
        <p className="max-w-2xl text-[#c5d2e6]">
          Invented data, same gate as a free scan. One finding is included. The counts are the real totals for this sample. The other findings are not in this preview.
        </p>
        <ReportView report={freePreview} targetLabel="Sample application" sample />
      </section>
      <h2 className="font-display text-4xl">Full sample report</h2>
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
      <img width={360} height={68} alt={caption} src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} />
      <figcaption className="mt-1 text-xs text-[#b7b1a4]">{caption}. Public badges show the score and date only.</figcaption>
    </figure>
  );
}
