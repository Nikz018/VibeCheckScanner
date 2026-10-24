import { isScanStale, renderBadgeSvg } from "@/lib/badge";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const scan = await prisma.scan.findFirst({
    where: { shareToken: token, shareEnabled: true, status: "completed" },
    select: { score: true, finishedAt: true, passed: true },
  });
  if (!scan || scan.score === null || !scan.finishedAt) {
    return new Response("Not found", { status: 404 });
  }
  const svg = renderBadgeSvg({
    score: scan.score,
    finishedAt: scan.finishedAt,
    passed: scan.passed,
    stale: isScanStale(scan.finishedAt),
  });
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
