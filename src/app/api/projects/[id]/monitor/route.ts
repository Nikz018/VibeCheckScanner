import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { monitoringActive } from "@/lib/entitlements";

const bodySchema = z.object({ enabled: z.boolean() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await context.params;
  const project = await prisma.project.findFirst({ where: { id, userId: user.id } });
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Missing enabled flag." }, { status: 400 });
  if (parsed.data.enabled) {
    if (!project.ownershipVerifiedAt) return NextResponse.json({ error: "Verify ownership before monitoring." }, { status: 400 });
    if (!monitoringActive(user.subscription?.status)) {
      return NextResponse.json({ error: "Monitoring needs an active subscription." }, { status: 402 });
    }
  }
  await prisma.project.update({ where: { id: project.id }, data: { monitorEnabled: parsed.data.enabled } });
  return NextResponse.json({ enabled: parsed.data.enabled });
}
