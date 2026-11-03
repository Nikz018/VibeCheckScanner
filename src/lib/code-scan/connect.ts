import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { enqueueCodeScan } from "@/lib/queue";
import { recordScanAuthorization } from "@/lib/scan-authorization";
import { parseCodeReport, shellCodeReport } from "./parse";
import { repoSnapshotData } from "./repo-lock";

export async function projectHasPaidCodeScan(userId: string, projectId: string): Promise<boolean> {
  const enabled = await prisma.scan.findFirst({
    where: { userId, projectId, codeScanEnabled: true },
    select: { id: true },
  });
  if (enabled) return true;
  const purchases = await prisma.purchase.findMany({
    where: { userId, status: "paid", tier: "rescan" },
    select: { scanId: true, fullScanId: true },
  });
  const ids = [...new Set(purchases.flatMap((row) => [row.scanId, row.fullScanId].filter((id): id is string => Boolean(id))))];
  if (ids.length === 0) return false;
  const scan = await prisma.scan.findFirst({
    where: { userId, projectId, id: { in: ids } },
    select: { id: true },
  });
  return Boolean(scan);
}

export async function saveConnectedRepo(input: {
  userId: string;
  userEmail: string;
  projectId: string;
  targetUrl: string;
  installationId: string;
  repoId: string;
  owner: string;
  name: string;
  defaultBranch: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const other = await prisma.repoLink.findFirst({
    where: { userId: input.userId, repoId: input.repoId, status: "connected", NOT: { projectId: input.projectId } },
  });
  if (other) return { ok: false, error: "That repository is already connected to another project." };
  await prisma.repoLink.upsert({
    where: { projectId: input.projectId },
    update: {
      installationId: input.installationId,
      repoId: input.repoId,
      owner: input.owner,
      name: input.name,
      defaultBranch: input.defaultBranch,
      status: "connected",
      connectedAt: new Date(),
    },
    create: {
      projectId: input.projectId,
      userId: input.userId,
      installationId: input.installationId,
      repoId: input.repoId,
      owner: input.owner,
      name: input.name,
      defaultBranch: input.defaultBranch,
      status: "connected",
    },
  });
  await recordScanAuthorization({
    userId: input.userId,
    userEmail: input.userEmail,
    projectId: input.projectId,
    targetUrl: input.targetUrl,
    kind: "ownership",
    method: "github_app",
    note: `Read-only contents on ${input.owner}/${input.name}`,
  }).catch((error) => {
    console.error("github authorization record failed", error instanceof Error ? error.message : "error");
  });
  return { ok: true };
}

export async function queueCodeScanForProject(userId: string, projectId: string): Promise<{ ok: true; scanId: string } | { ok: false; error: string; status: number }> {
  const scan = await prisma.scan.findFirst({
    where: { userId, projectId, codeScanEnabled: true, status: "completed" },
    orderBy: { finishedAt: "desc" },
    include: { project: { include: { repoLink: true } } },
  });
  if (!scan) return { ok: false, status: 400, error: "Finish a site scan on the $99 plan before running the code scan." };
  const current = parseCodeReport(scan.codeReport);
  if (current && (current.status === "running" || current.status === "queued")) {
    return { ok: false, status: 429, error: "A code scan is already running." };
  }
  const locked = Boolean(scan.codeRepoOwner && scan.codeRepoName && scan.codeRepoInstallationId);
  const snapshot = locked ? {} : repoSnapshotData(scan.project.repoLink?.status === "connected" ? scan.project.repoLink : null);
  if (!locked && !("codeRepoOwner" in snapshot)) {
    return { ok: false, status: 400, error: "Connect one repository before running the code scan." };
  }
  const queued = shellCodeReport("queued", ["The code scan is queued. This page will refresh when it finishes."]);
  await prisma.scan.update({
    where: { id: scan.id },
    data: {
      codeReport: queued as unknown as Prisma.InputJsonObject,
      codeScanChoice: "connect",
      ...snapshot,
    },
  });
  try {
    await enqueueCodeScan(scan.id);
  } catch (error) {
    console.error("code scan queue failed", error instanceof Error ? error.message : "error");
    await prisma.scan.update({
      where: { id: scan.id },
      data: {
        codeReport: shellCodeReport("failed", ["The scan queue is unavailable. Try the code scan again when it is back."]) as unknown as Prisma.InputJsonObject,
      },
    });
    return { ok: false, status: 503, error: "The scan queue is unavailable." };
  }
  return { ok: true, scanId: scan.id };
}
