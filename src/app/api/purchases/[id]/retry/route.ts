import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { retryPaidFullScan } from "@/lib/payments/paid-full-scan";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await context.params;
  const result = await retryPaidFullScan(user.id, id);
  if (result.outcome === "not_found") return NextResponse.json({ error: "Purchase not found." }, { status: 404 });
  if (result.outcome === "not_applicable") return NextResponse.json({ error: "This purchase does not start a full scan." }, { status: 400 });
  if (result.outcome === "needs_ownership") {
    return NextResponse.json({ error: result.reason, needsOwnership: true }, { status: 409 });
  }
  if (result.outcome === "limited") return NextResponse.json({ error: result.reason }, { status: 429 });
  if (result.outcome === "queue_unavailable") {
    return NextResponse.json({ error: result.reason, scanId: result.scanId }, { status: 503 });
  }
  return NextResponse.json({ scanId: result.scanId, outcome: result.outcome });
}
