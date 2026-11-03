import { prisma } from "../db";
import { githubAppConfig } from "../github/app";
import { CONSENT_TEXT, verifyOwnership } from "../ownership";
import { enqueuePaidScan } from "../queue";
import { recordScanAuthorization } from "../scan-authorization";
import {
  ACTIVE_SCAN_LIMIT,
  ACTIVE_SCAN_LIMIT_MESSAGE,
  QUEUE_UNAVAILABLE_MESSAGE,
} from "./paid-scan-status";

const OWNERSHIP_FALLBACK = "Ownership proof was not found. Publish the token in DNS TXT or at /.well-known/vibecheck-verify.txt and try again.";

export type OwnershipVerifier = (
  targetUrl: string,
  token: string,
) => Promise<{ ok: boolean; method?: "well_known" | "dns_txt"; reason?: string }>;

export type CodeRepoChoice = "skip" | "connect";

export interface PaidFullScanDeps {
  verifyOwnership?: OwnershipVerifier;
  enqueueScan?: (scanId: string) => Promise<void>;
  /** Overrides the live GitHub App check. Unset uses the server environment. */
  githubConfigured?: boolean;
  codeChoice?: CodeRepoChoice;
}

export type PaidFullScanOutcome =
  | { outcome: "started"; scanId: string }
  | { outcome: "already_started"; scanId: string }
  | { outcome: "needs_ownership"; reason: string }
  | { outcome: "limited"; reason: string }
  | { outcome: "queue_unavailable"; scanId: string; reason: string }
  | { outcome: "needs_repo" }
  | { outcome: "not_applicable" }
  | { outcome: "not_found" };

export async function fulfillPaidMiniScan(input: {
  userId: string;
  purchaseId: string;
  deps?: PaidFullScanDeps;
}): Promise<PaidFullScanOutcome> {
  return startPaidFullScan({ ...input, retry: false });
}

export async function retryPaidFullScan(userId: string, purchaseId: string, deps?: PaidFullScanDeps): Promise<PaidFullScanOutcome> {
  return startPaidFullScan({ userId, purchaseId, retry: true, deps });
}

export async function choosePaidCodeScan(input: {
  userId: string;
  purchaseId: string;
  choice: CodeRepoChoice;
  deps?: PaidFullScanDeps;
}): Promise<PaidFullScanOutcome> {
  return startPaidFullScan({
    userId: input.userId,
    purchaseId: input.purchaseId,
    retry: false,
    deps: { ...input.deps, codeChoice: input.choice },
  });
}

/** After a repository is saved, start a waiting $99 scan so the site and code scans share one job. */
export async function resumeAfterRepoChoice(
  userId: string,
  projectId: string,
  returnTo: string | null,
  deps?: PaidFullScanDeps,
): Promise<{ kind: "progress"; redirect: string; scanId: string } | { kind: "step"; redirect: string } | { kind: "later" }> {
  const purchases = await prisma.purchase.findMany({
    where: { userId, status: "paid", tier: "rescan", fullScanId: null },
    orderBy: { createdAt: "desc" },
  });
  for (const purchase of purchases) {
    if (!purchase.scanId) continue;
    const preview = await prisma.scan.findFirst({
      where: { id: purchase.scanId, userId, projectId, mode: "mini" },
      select: { id: true },
    });
    if (!preview) continue;
    const outcome = await startPaidFullScan({
      userId,
      purchaseId: purchase.id,
      retry: false,
      deps: { ...deps, codeChoice: "connect" },
    });
    const scanId = paidScanId(outcome);
    if (scanId) return { kind: "progress", redirect: `/scans/${scanId}`, scanId };
    return { kind: "step", redirect: returnTo || `/scans/${preview.id}?checkout=success` };
  }
  if (returnTo) return { kind: "step", redirect: returnTo };
  return { kind: "later" };
}

export function paidScanId(outcome: PaidFullScanOutcome): string | null {
  if (outcome.outcome === "started" || outcome.outcome === "already_started" || outcome.outcome === "queue_unavailable") return outcome.scanId;
  return null;
}

async function startPaidFullScan(input: {
  userId: string;
  purchaseId: string;
  retry: boolean;
  deps?: PaidFullScanDeps;
}): Promise<PaidFullScanOutcome> {
  const checkOwnership = input.deps?.verifyOwnership ?? verifyOwnership;
  const enqueue = input.deps?.enqueueScan ?? enqueuePaidScan;
  const purchase = await prisma.purchase.findFirst({
    where: { id: input.purchaseId, userId: input.userId },
    include: { user: true, fullScan: true },
  });
  if (!purchase) return { outcome: "not_found" };
  if (purchase.status !== "paid" || (purchase.tier !== "report" && purchase.tier !== "rescan") || !purchase.scanId) {
    return { outcome: "not_applicable" };
  }
  const preview = await prisma.scan.findFirst({
    where: { id: purchase.scanId, userId: purchase.userId },
    include: { project: { include: { repoLink: true } } },
  });
  if (!preview) return { outcome: "not_found" };
  if (preview.mode !== "mini") return { outcome: "not_applicable" };

  if (purchase.fullScanId && purchase.fullScan) {
    if (purchase.fullScan.status === "failed" && input.retry) {
      return requeueFailedScan({
        purchaseId: purchase.id,
        scan: purchase.fullScan,
        userId: purchase.userId,
        userEmail: purchase.user.email,
        project: preview.project,
        checkOwnership,
        enqueue,
      });
    }
    if (purchase.fullScan.status === "queued" && !purchase.fullScan.startedAt) {
      try {
        await enqueue(purchase.fullScan.id);
      } catch (error) {
        console.error(error instanceof Error ? error.message : "queue unavailable");
      }
    }
    await rememberAuthorization({
      userId: purchase.userId,
      userEmail: purchase.user.email,
      projectId: preview.projectId,
      scanId: purchase.fullScan.id,
      targetUrl: purchase.fullScan.targetUrl,
      method: ownershipMethod(preview.project.ownershipMethod),
    });
    return { outcome: "already_started", scanId: purchase.fullScan.id };
  }

  const proof = await checkOwnership(preview.project.url, preview.project.ownershipToken);
  if (!proof.ok || !proof.method) {
    const reason = safeReason(proof.reason);
    await prisma.purchase.update({
      where: { id: purchase.id },
      data: { ownershipBlock: reason, startNote: null },
    });
    return { outcome: "needs_ownership", reason };
  }

  const choice = resolveCodeChoice(input.deps?.codeChoice, purchase.codeScanChoice);
  const githubReady = isGithubConfigured(input.deps);
  const connected = repoIsConnected(preview.project.repoLink);
  if (purchase.tier === "rescan" && githubReady && !choice) {
    await prisma.purchase.update({
      where: { id: purchase.id },
      data: { ownershipBlock: null, startNote: null },
    });
    await stampProjectOwnership(preview.projectId, proof.method);
    return { outcome: "needs_repo" };
  }
  if (purchase.tier === "rescan" && choice === "connect" && !connected) {
    await stampProjectOwnership(preview.projectId, proof.method);
    return { outcome: "needs_repo" };
  }
  if (input.deps?.codeChoice && purchase.codeScanChoice !== input.deps.codeChoice) {
    await prisma.purchase.update({
      where: { id: purchase.id },
      data: { codeScanChoice: input.deps.codeChoice },
    });
  }

  const active = await prisma.scan.count({
    where: { userId: purchase.userId, status: { in: ["queued", "running"] } },
  });
  if (active >= ACTIVE_SCAN_LIMIT) {
    await prisma.purchase.update({
      where: { id: purchase.id },
      data: { startNote: ACTIVE_SCAN_LIMIT_MESSAGE, ownershipBlock: null },
    });
    return { outcome: "limited", reason: ACTIVE_SCAN_LIMIT_MESSAGE };
  }

  const scan = await prisma.scan.create({
    data: {
      projectId: preview.projectId,
      userId: purchase.userId,
      status: "queued",
      mode: "full",
      reportAccess: "full",
      codeScanEnabled: purchase.tier === "rescan",
      targetUrl: preview.project.url,
      consentAt: new Date(),
      consentText: CONSENT_TEXT,
    },
  });
  const claimed = await prisma.purchase.updateMany({
    where: { id: purchase.id, fullScanId: null },
    data: { fullScanId: scan.id, ownershipBlock: null, startNote: null },
  });
  if (claimed.count !== 1) {
    await prisma.scan.delete({ where: { id: scan.id } }).catch(() => undefined);
    const current = await prisma.purchase.findUnique({ where: { id: purchase.id } });
    if (current?.fullScanId) return { outcome: "already_started", scanId: current.fullScanId };
    return { outcome: "not_applicable" };
  }

  const queued = await enqueueOrFail(scan.id, enqueue);
  await rememberAuthorization({
    userId: purchase.userId,
    userEmail: purchase.user.email,
    projectId: preview.projectId,
    scanId: scan.id,
    targetUrl: preview.project.url,
    method: proof.method,
  });
  await stampProjectOwnership(preview.projectId, proof.method);
  return queued;
}

async function requeueFailedScan(input: {
  purchaseId: string;
  scan: { id: string; targetUrl: string; projectId: string };
  userId: string;
  userEmail: string;
  project: { id: string; url: string; ownershipToken: string; ownershipMethod: string | null };
  checkOwnership: OwnershipVerifier;
  enqueue: (scanId: string) => Promise<void>;
}): Promise<PaidFullScanOutcome> {
  const proof = await input.checkOwnership(input.project.url, input.project.ownershipToken);
  if (!proof.ok || !proof.method) {
    const reason = safeReason(proof.reason);
    await prisma.purchase.update({
      where: { id: input.purchaseId },
      data: { ownershipBlock: reason },
    });
    return { outcome: "needs_ownership", reason };
  }
  const active = await prisma.scan.count({
    where: { userId: input.userId, status: { in: ["queued", "running"] } },
  });
  if (active >= ACTIVE_SCAN_LIMIT) {
    await prisma.purchase.update({
      where: { id: input.purchaseId },
      data: { startNote: ACTIVE_SCAN_LIMIT_MESSAGE },
    });
    return { outcome: "limited", reason: ACTIVE_SCAN_LIMIT_MESSAGE };
  }
  await prisma.scan.update({
    where: { id: input.scan.id },
    data: {
      status: "queued",
      error: null,
      finishedAt: null,
      startedAt: null,
      consentAt: new Date(),
      consentText: CONSENT_TEXT,
    },
  });
  await prisma.purchase.update({
    where: { id: input.purchaseId },
    data: { ownershipBlock: null, startNote: null },
  });
  const queued = await enqueueOrFail(input.scan.id, input.enqueue);
  await rememberAuthorization({
    userId: input.userId,
    userEmail: input.userEmail,
    projectId: input.project.id,
    scanId: input.scan.id,
    targetUrl: input.scan.targetUrl,
    method: proof.method,
  });
  await stampProjectOwnership(input.project.id, proof.method);
  return queued;
}

async function rememberAuthorization(input: {
  userId: string;
  userEmail: string;
  projectId: string;
  scanId: string;
  targetUrl: string;
  method: "well_known" | "dns_txt" | null;
}): Promise<void> {
  try {
    await ensureAuthorizations(input);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "authorization record failed");
  }
}

async function enqueueOrFail(scanId: string, enqueue: (scanId: string) => Promise<void>): Promise<PaidFullScanOutcome> {
  try {
    await enqueue(scanId);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "queue unavailable");
    await prisma.scan.update({
      where: { id: scanId },
      data: { status: "failed", error: QUEUE_UNAVAILABLE_MESSAGE, finishedAt: new Date() },
    });
    return { outcome: "queue_unavailable", scanId, reason: QUEUE_UNAVAILABLE_MESSAGE };
  }
  return { outcome: "started", scanId };
}

async function ensureAuthorizations(input: {
  userId: string;
  userEmail: string;
  projectId: string;
  scanId: string;
  targetUrl: string;
  method: "well_known" | "dns_txt" | null;
}): Promise<void> {
  const consent = await prisma.scanAuthorization.findFirst({ where: { scanId: input.scanId, kind: "consent" } });
  if (!consent) {
    await recordScanAuthorization({
      userId: input.userId,
      userEmail: input.userEmail,
      projectId: input.projectId,
      scanId: input.scanId,
      targetUrl: input.targetUrl,
      kind: "consent",
      method: "checkbox",
      note: CONSENT_TEXT,
    });
  }
  if (!input.method) return;
  const ownership = await prisma.scanAuthorization.findFirst({ where: { scanId: input.scanId, kind: "ownership" } });
  if (!ownership) {
    await recordScanAuthorization({
      userId: input.userId,
      userEmail: input.userEmail,
      projectId: input.projectId,
      scanId: input.scanId,
      targetUrl: input.targetUrl,
      kind: "ownership",
      method: input.method,
    });
  }
}

function isGithubConfigured(deps?: PaidFullScanDeps): boolean {
  if (typeof deps?.githubConfigured === "boolean") return deps.githubConfigured;
  return githubAppConfig() !== null;
}

function resolveCodeChoice(explicit: CodeRepoChoice | undefined, stored: string | null): CodeRepoChoice | null {
  if (explicit === "skip" || explicit === "connect") return explicit;
  if (stored === "skip" || stored === "connect") return stored;
  return null;
}

function repoIsConnected(link: { status: string; owner: string; name: string } | null | undefined): boolean {
  return Boolean(link && link.status === "connected" && link.owner && link.name);
}

async function stampProjectOwnership(projectId: string, method: "well_known" | "dns_txt"): Promise<void> {
  await prisma.project
    .update({
      where: { id: projectId },
      data: { ownershipVerifiedAt: new Date(), ownershipMethod: method },
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "ownership stamp failed");
    });
}

function ownershipMethod(method: string | null): "well_known" | "dns_txt" | null {
  if (method === "well_known" || method === "dns_txt") return method;
  return null;
}

function safeReason(reason: string | undefined): string {
  const text = (reason || OWNERSHIP_FALLBACK).replace(/\s+/g, " ").trim();
  return text.slice(0, 500) || OWNERSHIP_FALLBACK;
}
