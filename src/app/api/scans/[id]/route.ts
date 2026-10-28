import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { progressPercent, stageState } from "@/lib/scan-progress";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await context.params;
  const scan = await prisma.scan.findFirst({
    where: { id, userId: user.id },
    select: {
      status: true,
      error: true,
      mode: true,
      progressStage: true,
      pagesDiscovered: true,
      startedAt: true,
      createdAt: true,
    },
  });
  if (!scan) return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  return NextResponse.json({
    status: scan.status,
    error: scan.error,
    mode: scan.mode,
    stage: scan.progressStage,
    pagesDiscovered: scan.pagesDiscovered,
    startedAt: scan.startedAt?.toISOString() ?? null,
    createdAt: scan.createdAt.toISOString(),
    progress: progressPercent({ mode: scan.mode, stage: scan.progressStage, status: scan.status }),
    stages: stageState({ mode: scan.mode, stage: scan.progressStage, status: scan.status }),
  });
}
