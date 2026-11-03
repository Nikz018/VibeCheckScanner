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
      codeReport: true,
      codeScanEnabled: true,
      project: { select: { repoLink: { select: { status: true, owner: true, name: true } } } },
    },
  });
  if (!scan) return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  const codeScan = Boolean(scan.codeScanEnabled && scan.project.repoLink?.status === "connected" && scan.project.repoLink.owner && scan.project.repoLink.name);
  return NextResponse.json({
    status: scan.status,
    error: scan.error,
    mode: scan.mode,
    stage: scan.progressStage,
    pagesDiscovered: scan.pagesDiscovered,
    startedAt: scan.startedAt?.toISOString() ?? null,
    createdAt: scan.createdAt.toISOString(),
    codeScan,
    codeStatus: readCodeStatus(scan.codeReport),
    progress: progressPercent({ mode: scan.mode, stage: scan.progressStage, status: scan.status, codeScan }),
    stages: stageState({ mode: scan.mode, stage: scan.progressStage, status: scan.status, codeScan }),
  });
}

function readCodeStatus(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("status" in value)) return null;
  const status = (value as { status?: unknown }).status;
  return typeof status === "string" ? status : null;
}
