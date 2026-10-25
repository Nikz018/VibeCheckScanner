import { NextResponse } from "next/server";
import { downloadBasename, renderFixMarkdown } from "@/lib/download";
import { requirePaidScan } from "@/lib/paid-scan";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const loaded = await requirePaidScan(id);
  if (!loaded.ok) return loaded.response;
  const markdown = renderFixMarkdown(loaded.report, loaded.targetUrl);
  const name = downloadBasename(loaded.targetUrl, loaded.report.finishedAt ? new Date(loaded.report.finishedAt) : null);
  return new NextResponse(markdown, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${name}.md"`,
      "cache-control": "no-store",
    },
  });
}
