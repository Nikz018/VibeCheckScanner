import { prisma } from "./db";
import { CONSENT_TEXT, verifyOwnership } from "./ownership";
import { enqueueScan } from "./queue";
import { recordScanAuthorization } from "./scan-authorization";
import { ACTIVE_SCAN_LIMIT, ACTIVE_SCAN_LIMIT_MESSAGE } from "./payments/paid-scan-status";

const RETRY_QUEUE_MESSAGE = "The scan queue is unavailable. Retry when the queue is back.";

export async function retryOwnedScan(userId: string, scanId: string): Promise<{ ok: true; scanId: string } | { ok: false; status: number; error: string }> {
  const scan = await prisma.scan.findFirst({
    where: { id: scanId, userId },
    include: { project: true, user: true },
  });
  if (!scan) return { ok: false, status: 404, error: "Scan not found." };
  if (scan.status !== "failed") return { ok: false, status: 400, error: "This scan is not waiting for a retry." };
  if (!scan.consentAt) return { ok: false, status: 400, error: "Consent was not recorded for this scan." };

  const proof = await verifyOwnership(scan.project.url, scan.project.ownershipToken);
  if (!proof.ok || !proof.method) {
    return { ok: false, status: 400, error: proof.reason || "Ownership proof was not found. Publish it again, then retry." };
  }

  const active = await prisma.scan.count({
    where: { userId, status: { in: ["queued", "running"] } },
  });
  if (active >= ACTIVE_SCAN_LIMIT) return { ok: false, status: 429, error: ACTIVE_SCAN_LIMIT_MESSAGE };

  await prisma.scan.update({
    where: { id: scan.id },
    data: {
      status: "queued",
      error: null,
      finishedAt: null,
      startedAt: null,
      progressStage: null,
      pagesDiscovered: 0,
      consentAt: new Date(),
      consentText: CONSENT_TEXT,
    },
  });
  await prisma.project
    .update({
      where: { id: scan.projectId },
      data: { ownershipVerifiedAt: new Date(), ownershipMethod: proof.method },
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "ownership stamp failed");
    });

  try {
    const consent = await prisma.scanAuthorization.findFirst({ where: { scanId: scan.id, kind: "consent" } });
    if (!consent) {
      await recordScanAuthorization({
        userId: scan.userId,
        userEmail: scan.user.email,
        projectId: scan.projectId,
        scanId: scan.id,
        targetUrl: scan.targetUrl,
        kind: "consent",
        method: "checkbox",
        note: CONSENT_TEXT,
      });
    }
    await recordScanAuthorization({
      userId: scan.userId,
      userEmail: scan.user.email,
      projectId: scan.projectId,
      scanId: scan.id,
      targetUrl: scan.targetUrl,
      kind: "ownership",
      method: proof.method,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "authorization record failed");
  }

  try {
    await enqueueScan(scan.id);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "queue unavailable");
    await prisma.scan.update({
      where: { id: scan.id },
      data: { status: "failed", error: RETRY_QUEUE_MESSAGE, finishedAt: new Date() },
    });
    return { ok: false, status: 503, error: RETRY_QUEUE_MESSAGE };
  }
  return { ok: true, scanId: scan.id };
}
