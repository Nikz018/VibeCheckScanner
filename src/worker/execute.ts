import { Prisma } from "@prisma/client";
import { getCheck } from "@/lib/catalog";
import { deleteScanCredentials, loadScanCredentials } from "@/lib/credential-store";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { renderMonitorAlertEmail } from "@/lib/email-template";
import type { AuthScanPayload } from "@/lib/auth-input";
import { verifyOwnership } from "@/lib/ownership";
import { paidReportAlertMessage, paidReportNotice } from "@/lib/payments/paid-scan-status";
import { recordScanAuthorization } from "@/lib/scan-authorization";
import { countNewMonitorIssues } from "@/lib/monitor-alerts";
import { buildCustomerReport, type RawCheckResult } from "@/lib/report";
import { clampText, sanitizeCode, sanitizeCustomerText } from "@/lib/sanitize";
import { computeScore, isPassingScore } from "@/lib/score";
import type { ScanStageId } from "@/lib/scan-progress";
import { runScanPipeline } from "./run-scan";

export async function executeScan(scanId: string): Promise<void> {
  const scan = await prisma.scan.findUnique({
    where: { id: scanId },
    include: { project: true, user: true },
  });
  if (!scan || scan.status === "completed") return;
  try {
    await runQueuedScan(scan);
  } finally {
    await deleteScanCredentials(scan.id).catch((error) => {
      console.error("credential delete failed", error instanceof Error ? error.message : "error");
    });
  }
}

async function runQueuedScan(scan: Prisma.ScanGetPayload<{ include: { project: true; user: true } }>): Promise<void> {
  if (!scan.consentAt) {
    await fail(scan.id, "Consent was not recorded for this scan.");
    return;
  }

  await prisma.scan.update({
    where: { id: scan.id },
    data: { status: "running", startedAt: new Date(), error: null, progressStage: "ownership" },
  });

  const proof = await verifyOwnership(scan.targetUrl, scan.project.ownershipToken);
  if (!proof.ok) {
    await fail(scan.id, "Ownership proof was missing when the scan started. Publish the token again and rerun.");
    return;
  }
  if (!proof.method) {
    await fail(scan.id, "Ownership proof was missing when the scan started. Publish the token again and rerun.");
    return;
  }
  if (!scan.project.ownershipVerifiedAt || scan.project.ownershipMethod !== proof.method) {
    await prisma.project.update({
      where: { id: scan.projectId },
      data: { ownershipVerifiedAt: new Date(), ownershipMethod: proof.method },
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

  try {
    let auth: AuthScanPayload | null = null;
    let authError: string | null = null;
    if (scan.mode !== "mini" && scan.reportAccess === "full") {
      try {
        auth = await loadScanCredentials(scan.id);
      } catch (error) {
        console.error("credential read failed", error instanceof Error ? error.message : "error");
        authError = "Logged-in checks skipped: stored test-account credentials could not be read. Unauthenticated checks still ran.";
      }
    }
    const output = await runScanPipeline({
      targetUrl: scan.targetUrl,
      mode: scan.mode === "mini" ? "mini" : "full",
      ownershipConfirmed: true,
      auth,
      authError,
      reportAccess: scan.reportAccess === "full" ? "full" : "teaser",
      onProgress: (update) => recordProgress(scan.id, update.stage, update.pagesDiscovered),
    });
    const finishedAt = new Date();
    const severities = output.results.map((result) => ({ severity: result.severity ?? getCheck(result.checkId).severity }));
    const finalScore = computeScore(severities);
    const passed = isPassingScore(finalScore, severities);
    const report = buildCustomerReport({
      scanId: scan.id,
      status: "completed",
      mode: scan.mode === "mini" ? "mini" : "full",
      access: "full",
      finishedAt,
      results: output.results,
      marked: output.marked,
      notices: output.notices,
      pagesScanned: output.pagesScanned,
    });

    await prisma.finding.deleteMany({ where: { scanId: scan.id } });
    for (const result of output.results) {
      const check = getCheck(result.checkId);
      const severity = result.severity ?? check.severity;
      await prisma.finding.create({
        data: {
          scanId: scan.id,
          checkId: check.id,
          family: check.family,
          severity,
          title: sanitizeCustomerText(result.title ?? check.title),
          evidence: clampText(result.evidence),
          impact: sanitizeCustomerText(result.impact ?? check.impact),
          fix: sanitizeCode(result.fix ?? check.fix),
          headlineRank: check.headlineRank,
          sortOrder: check.headlineRank ?? 50 + ["critical", "high", "medium", "low", "info"].indexOf(severity),
          raw: JSON.parse(
            JSON.stringify({
              locations: result.locations ?? [],
              proof: result.proof ?? null,
              steps: result.steps ?? [],
              confidence: result.confidence ?? null,
              affectedPages: result.affectedPages ?? [],
              advisories: result.advisories ?? [],
            }),
          ) as Prisma.InputJsonObject,
        },
      });
    }

    await prisma.scan.update({
      where: { id: scan.id },
      data: {
        status: "completed",
        finishedAt,
        score: finalScore,
        passed,
        severityCounts: report.severityCounts as unknown as Prisma.InputJsonObject,
        coverage: { marked: output.marked, notices: output.notices, pagesScanned: output.pagesScanned } as unknown as Prisma.InputJsonObject,
        error: null,
      },
    });

    if (scan.scheduled) {
      await maybeAlert(scan.id, scan.projectId, scan.userId, scan.user.email, scan.targetUrl, output.results);
    }
    await notifyPaidReport(scan.id, scan.userId, scan.user.email, scan.targetUrl);
  } catch (error) {
    console.error("scan failed", error instanceof Error ? error.message : "error");
    await fail(scan.id, "The scan could not finish. Confirm the site is reachable and try again.");
  }
}

async function maybeAlert(
  scanId: string,
  projectId: string,
  userId: string,
  email: string,
  targetUrl: string,
  results: RawCheckResult[],
): Promise<void> {
  const previous = await prisma.scan.findFirst({
    where: { projectId, status: "completed", id: { not: scanId } },
    orderBy: { finishedAt: "desc" },
    include: { findings: true },
  });
  const fresh = countNewMonitorIssues(
    previous?.findings ?? [],
    results.map((result) => ({
      checkId: result.checkId,
      severity: result.severity ?? getCheck(result.checkId).severity,
      advisories: result.advisories,
    })),
  );
  if (fresh === 0) return;
  const host = new URL(targetUrl).host;
  const link = `${process.env.APP_URL || "http://localhost:3000"}/scans/${scanId}`;
  const alert = renderMonitorAlertEmail(host, fresh, link);
  await prisma.alert.create({ data: { userId, scanId, message: alert.message } });
  await sendEmail({ to: email, subject: alert.subject, text: alert.text, html: alert.html });
}

async function notifyPaidReport(scanId: string, userId: string, email: string, targetUrl: string): Promise<void> {
  try {
    const purchase = await prisma.purchase.findFirst({ where: { fullScanId: scanId, status: "paid" } });
    if (!purchase) return;
    const host = new URL(targetUrl).host;
    const link = `${process.env.APP_URL || "http://localhost:3000"}/scans/${scanId}`;
    const notice = paidReportNotice(host, link);
    await prisma.alert.create({ data: { userId, scanId, message: paidReportAlertMessage(host) } });
    await sendEmail({ to: email, subject: notice.subject, text: notice.text, html: notice.html });
  } catch (error) {
    console.error("full report notice failed", error instanceof Error ? error.message : "error");
  }
}

async function recordProgress(scanId: string, stage: ScanStageId, pagesDiscovered?: number): Promise<void> {
  try {
    await prisma.scan.update({
      where: { id: scanId },
      data: {
        progressStage: stage,
        ...(pagesDiscovered !== undefined ? { pagesDiscovered } : {}),
      },
    });
  } catch (error) {
    console.error("progress update failed", error instanceof Error ? error.message : "error");
  }
}

async function fail(scanId: string, error: string): Promise<void> {
  await prisma.scan.update({
    where: { id: scanId },
    data: {
      status: "failed",
      error,
      finishedAt: new Date(),
      coverage: { marked: {} } satisfies Prisma.InputJsonObject,
    },
  });
}
