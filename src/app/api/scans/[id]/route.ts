import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publicScanStatus } from "@/lib/scan-status";

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
      codeScanChoice: true,
      codeRepoOwner: true,
      codeRepoName: true,
      project: { select: { repoLink: { select: { status: true, owner: true, name: true } } } },
    },
  });
  if (!scan) return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  const lockedRepo = Boolean(scan.codeRepoOwner && scan.codeRepoName);
  const linkedRepo = Boolean(scan.project.repoLink?.status === "connected" && scan.project.repoLink.owner && scan.project.repoLink.name);
  const codeScan = Boolean(scan.codeScanEnabled && scan.codeScanChoice !== "skip" && (lockedRepo || linkedRepo));
  return NextResponse.json(
    publicScanStatus({
      status: scan.status,
      error: scan.error,
      mode: scan.mode,
      stage: scan.progressStage,
      pagesDiscovered: scan.pagesDiscovered,
      startedAt: scan.startedAt,
      createdAt: scan.createdAt,
      codeScan,
      codeReport: scan.codeReport,
    }),
  );
}
