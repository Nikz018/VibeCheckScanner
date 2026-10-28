import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { retryOwnedScan } from "@/lib/scan-retry";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await context.params;
  const result = await retryOwnedScan(user.id, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ scanId: result.scanId });
}
