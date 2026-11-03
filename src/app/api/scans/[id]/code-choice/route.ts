import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { chooseHeldCreditScan } from "@/lib/code-scan/held-scan";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as { choice?: unknown } | null;
  const choice = body?.choice === "skip" || body?.choice === "connect" ? body.choice : null;
  if (!choice) return NextResponse.json({ error: "Choose a repository or skip the code scan." }, { status: 400 });
  const result = await chooseHeldCreditScan({ userId: user.id, scanId: id, choice });
  if (result.outcome === "not_found") return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  if (result.outcome === "not_applicable") {
    return NextResponse.json({ error: "This scan is not waiting for a repository choice." }, { status: 400 });
  }
  if (result.outcome === "needs_repo") {
    return NextResponse.json({ error: "Connect a repository or skip the code scan before the scan starts.", needsRepo: true }, { status: 409 });
  }
  if (result.outcome === "limited") return NextResponse.json({ error: result.reason }, { status: 429 });
  if (result.outcome === "queue_unavailable") {
    return NextResponse.json({ error: result.reason, scanId: result.scanId }, { status: 503 });
  }
  return NextResponse.json({ scanId: result.scanId, outcome: result.outcome });
}
