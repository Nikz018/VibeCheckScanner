import { NextResponse } from "next/server";
import { renderCodeScanMarkdown } from "@/lib/code-scan/format";
import { parseCodeReport } from "@/lib/code-scan/parse";
import { prisma } from "@/lib/db";
import { downloadBasename, renderPrintHtml } from "@/lib/download";
import { requirePaidScan } from "@/lib/paid-scan";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const loaded = await requirePaidScan(id);
  if (!loaded.ok) return loaded.response;
  const stored = await prisma.scan.findUnique({ where: { id }, select: { codeScanEnabled: true, codeReport: true } });
  const code = stored?.codeScanEnabled ? parseCodeReport(stored.codeReport) : null;
  const extra = renderCodeScanMarkdown(code);
  const html = renderPrintHtml(loaded.report, loaded.targetUrl).replace(
    "</body>",
    extra ? `<section class="finding"><pre>${escapePrint(extra)}</pre></section></body>` : "</body>",
  );
  const name = downloadBasename(loaded.targetUrl, loaded.report.finishedAt ? new Date(loaded.report.finishedAt) : null);
  return new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `inline; filename="${name}.html"`,
      "cache-control": "no-store",
    },
  });
}

function escapePrint(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
