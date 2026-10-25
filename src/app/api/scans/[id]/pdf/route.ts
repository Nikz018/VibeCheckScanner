import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { downloadBasename } from "@/lib/download";
import { requirePaidScan } from "@/lib/paid-scan";
import { renderReportPdf } from "@/lib/render-pdf";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const loaded = await requirePaidScan(id);
  if (!loaded.ok) return loaded.response;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const origin = process.env.APP_URL || new URL(request.url).origin;
  const printUrl = `${origin.replace(/\/$/, "")}/api/scans/${id}/print`;
  try {
    const pdf = await renderReportPdf(printUrl, token);
    const name = downloadBasename(loaded.targetUrl, loaded.report.finishedAt ? new Date(loaded.report.finishedAt) : null);
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${name}.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "The PDF could not be created. Try again." }, { status: 503 });
  }
}
