import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { queueCodeScanForProject } from "@/lib/code-scan/connect";
import { canRunCodeScan } from "@/lib/code-scan/gate";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await context.params;
  const project = await prisma.project.findFirst({
    where: { id, userId: user.id },
    include: { repoLink: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const entitled = await prisma.scan.findFirst({
    where: { userId: user.id, projectId: project.id, codeScanEnabled: true },
    select: { id: true },
  });
  const gate = canRunCodeScan({
    ownershipVerified: Boolean(project.ownershipVerifiedAt),
    codeScanEnabled: Boolean(entitled),
    repoConnected: project.repoLink?.status === "connected" && Boolean(project.repoLink.owner && project.repoLink.name),
  });
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 403 });
  const queued = await queueCodeScanForProject(user.id, project.id);
  if (!queued.ok) return NextResponse.json({ error: queued.error }, { status: queued.status });
  return NextResponse.json({ scanId: queued.scanId });
}
