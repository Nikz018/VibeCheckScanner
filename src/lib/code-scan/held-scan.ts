import { prisma } from "@/lib/db";
import { CONSENT_TEXT } from "@/lib/ownership";
import { enqueueScan as enqueueScanJob } from "@/lib/queue";
import { ACTIVE_SCAN_LIMIT, ACTIVE_SCAN_LIMIT_MESSAGE } from "@/lib/payments/paid-scan-status";
import { AWAITING_REPO_STATUS, creditScanShouldWaitForRepo, type CodeScanChoice } from "./gate";
import { repoSnapshotData } from "./repo-lock";

const QUEUE_ERROR = "The scan queue is unavailable.";
const QUEUE_RESPONSE = "The scan queue is unavailable. Check Redis and try again.";

export function repoIsConnected(link: { status: string; owner: string; name: string } | null | undefined): boolean {
  return Boolean(link && link.status === "connected" && link.owner && link.name);
}

export async function openHeldOrQueuedScan(input: {
  userId: string;
  projectId: string;
  mode: "full" | "mini";
  reportAccess: "teaser" | "full";
  codeScanEnabled: boolean;
  targetUrl: string;
  githubConfigured: boolean;
  repoConnected: boolean;
}): Promise<{ scanId: string; needsRepo: boolean }> {
  const needsRepo = creditScanShouldWaitForRepo({
    codeScanEnabled: input.codeScanEnabled,
    githubConfigured: input.githubConfigured,
    repoConnected: input.repoConnected,
  });
  const scan = await prisma.scan.create({
    data: {
      projectId: input.projectId,
      userId: input.userId,
      status: needsRepo ? AWAITING_REPO_STATUS : "queued",
      mode: input.mode,
      reportAccess: input.reportAccess,
      codeScanEnabled: input.codeScanEnabled,
      codeScanChoice: null,
      targetUrl: input.targetUrl,
      consentAt: new Date(),
      consentText: CONSENT_TEXT,
    },
  });
  return { scanId: scan.id, needsRepo };
}

/** Queue the scan, or leave it waiting for the repository step. Does not spend a credit. */
export async function settleVerifiedScan(input: {
  scanId: string;
  needsRepo: boolean;
  enqueueScan?: (scanId: string) => Promise<void>;
}): Promise<
  | { needsRepo: true; scanId: string }
  | { needsRepo: false; scanId: string; outcome: "started" | "queue_unavailable"; reason?: string }
> {
  if (input.needsRepo) return { needsRepo: true, scanId: input.scanId };
  const enqueue = input.enqueueScan ?? enqueueScanJob;
  try {
    await enqueue(input.scanId);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "queue unavailable");
    await prisma.scan.update({
      where: { id: input.scanId },
      data: { status: "failed", error: QUEUE_ERROR },
    });
    return { needsRepo: false, scanId: input.scanId, outcome: "queue_unavailable", reason: QUEUE_RESPONSE };
  }
  return { needsRepo: false, scanId: input.scanId, outcome: "started" };
}

export type HeldChoiceOutcome =
  | { outcome: "started"; scanId: string }
  | { outcome: "already_started"; scanId: string }
  | { outcome: "needs_repo" }
  | { outcome: "limited"; reason: string }
  | { outcome: "queue_unavailable"; scanId: string; reason: string }
  | { outcome: "not_found" }
  | { outcome: "not_applicable" };

/**
 * Connect or skip releases a held credit scan onto the queue once.
 * A second call sees the claimed row and does not enqueue again, and it does not spend a credit.
 */
export async function chooseHeldCreditScan(input: {
  userId: string;
  scanId: string;
  choice: CodeScanChoice;
  deps?: { enqueueScan?: (scanId: string) => Promise<void> };
}): Promise<HeldChoiceOutcome> {
  const enqueue = input.deps?.enqueueScan ?? enqueueScanJob;
  const scan = await prisma.scan.findFirst({
    where: { id: input.scanId, userId: input.userId },
    include: { project: { include: { repoLink: true } } },
  });
  if (!scan) return { outcome: "not_found" };
  if (!scan.codeScanEnabled) return { outcome: "not_applicable" };
  if (scan.status === "queued" || scan.status === "running" || scan.status === "completed") {
    return { outcome: "already_started", scanId: scan.id };
  }
  if (scan.status !== AWAITING_REPO_STATUS || scan.codeScanChoice) return { outcome: "not_applicable" };
  if (input.choice === "connect" && !repoIsConnected(scan.project.repoLink)) return { outcome: "needs_repo" };

  const active = await prisma.scan.count({
    where: { userId: input.userId, status: { in: ["queued", "running"] } },
  });
  if (active >= ACTIVE_SCAN_LIMIT) return { outcome: "limited", reason: ACTIVE_SCAN_LIMIT_MESSAGE };

  const claimed = await prisma.scan.updateMany({
    where: { id: scan.id, userId: input.userId, status: AWAITING_REPO_STATUS, codeScanChoice: null },
    data: {
      status: "queued",
      codeScanChoice: input.choice,
      ...(input.choice === "connect" ? repoSnapshotData(scan.project.repoLink) : {}),
    },
  });
  if (claimed.count === 1) {
    await prisma.purchase.updateMany({
      where: { fullScanId: scan.id, codeScanChoice: null },
      data: { codeScanChoice: input.choice },
    });
  }
  if (claimed.count !== 1) {
    const current = await prisma.scan.findFirst({ where: { id: scan.id, userId: input.userId } });
    if (current && (current.status === "queued" || current.status === "running" || current.status === "completed")) {
      return { outcome: "already_started", scanId: scan.id };
    }
    return { outcome: "not_applicable" };
  }

  try {
    await enqueue(scan.id);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "queue unavailable");
    await prisma.scan.update({
      where: { id: scan.id },
      data: { status: "failed", error: QUEUE_ERROR, finishedAt: new Date() },
    });
    return { outcome: "queue_unavailable", scanId: scan.id, reason: QUEUE_RESPONSE };
  }
  return { outcome: "started", scanId: scan.id };
}

/** After a repository is saved, queue the newest held credit scan for that project. */
export async function resumeHeldCreditScanAfterRepo(
  userId: string,
  projectId: string,
  deps?: { enqueueScan?: (scanId: string) => Promise<void> },
): Promise<{ scanId: string } | null> {
  const scan = await prisma.scan.findFirst({
    where: { userId, projectId, codeScanEnabled: true, status: AWAITING_REPO_STATUS, codeScanChoice: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!scan) return null;
  const result = await chooseHeldCreditScan({ userId, scanId: scan.id, choice: "connect", deps });
  if (result.outcome === "started" || result.outcome === "already_started" || result.outcome === "queue_unavailable") {
    return { scanId: result.scanId };
  }
  return null;
}
