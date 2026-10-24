import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

const bodySchema = z.object({ enabled: z.boolean() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await context.params;
  const scan = await prisma.scan.findFirst({ where: { id, userId: user.id } });
  if (!scan) return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  if (scan.status !== "completed" || scan.score === null) {
    return NextResponse.json({ error: "Sharing is available after the scan finishes." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Missing enabled flag." }, { status: 400 });
  const shareToken = scan.shareToken ?? randomBytes(18).toString("hex");
  await prisma.scan.update({
    where: { id: scan.id },
    data: { shareEnabled: parsed.data.enabled, shareToken },
  });
  return NextResponse.json({
    enabled: parsed.data.enabled,
    token: parsed.data.enabled ? shareToken : shareToken,
  });
}
