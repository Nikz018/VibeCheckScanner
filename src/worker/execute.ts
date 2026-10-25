import { Prisma } from "@prisma/client";
import { getCheck } from "@/lib/catalog";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { verifyOwnership } from "@/lib/ownership";
import { buildCustomerReport } from "@/lib/report";
import { clampText, sanitizeCode, sanitizeCustomerText } from "@/lib/sanitize";
import { computeScore, isPassingScore } from "@/lib/score";
import { runScanPipeline } from "./run-scan";

export async function executeScan(scanId: string): Promise<void> {
  const scan = await prisma.scan.findUnique({
    where: { id: scanId },
    include: { project: true, user: true },
  });
  if (!scan || scan.status === "completed") return;
  if (!scan.consentAt) {
    await fail(scan.id, "Consent was not recorded for this scan.");
    return;
  }

  await prisma.scan.update({
    where: { id: scan.id },
    data: { status: "running", startedAt: new Date(), error: null },
  });

  const proof = await verifyOwnership(scan.targetUrl, scan.project.ownershipToken);
  if (!proof.ok) {
    await fail(scan.id, "Ownership proof was missing when the scan started. Publish the token again and rerun.");
    return;
  }
  if (!scan.project.ownershipVerifiedAt || scan.project.ownershipMethod !== proof.method) {
    await prisma.project.update({
      where: { id: scan.projectId },
      data: { ownershipVerifiedAt: new Date(), ownershipMethod: proof.method },
    });
  }

  try {
    const output = await runScanPipeline({
      targetUrl: scan.targetUrl,
      mode: scan.mode === "mini" ? "mini" : "full",
      ownershipConfirmed: true,
    });
    const finishedAt = new Date();
    const severities = output.results.map((result) => ({ severity: getCheck(result.checkId).severity }));
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
    });

    await prisma.finding.deleteMany({ where: { scanId: scan.id } });
    for (const result of output.results) {
      const check = getCheck(result.checkId);
      await prisma.finding.create({
        data: {
          scanId: scan.id,
          checkId: check.id,
          family: check.family,
          severity: check.severity,
          title: sanitizeCustomerText(check.title),
          evidence: clampText(result.evidence),
          impact: sanitizeCustomerText(check.impact),
          fix: sanitizeCode(check.fix),
          headlineRank: check.headlineRank,
          sortOrder: check.headlineRank ?? 50 + ["critical", "high", "medium", "low", "info"].indexOf(check.severity),
          raw: JSON.parse(
            JSON.stringify({
              locations: result.locations ?? [],
              proof: result.proof ?? null,
              steps: result.steps ?? [],
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
        coverage: { marked: output.marked } as unknown as Prisma.InputJsonObject,
        error: null,
      },
    });

    if (scan.scheduled) {
      await maybeAlert(
        scan.id,
        scan.projectId,
        scan.userId,
        scan.user.email,
        scan.targetUrl,
        output.results.map((result) => result.checkId),
      );
    }
  } catch (error) {
    console.error(error);
    await fail(scan.id, "The scan could not finish. Confirm the site is reachable and try again.");
  }
}

async function maybeAlert(
  scanId: string,
  projectId: string,
  userId: string,
  email: string,
  targetUrl: string,
  checkIds: string[],
): Promise<void> {
  const previous = await prisma.scan.findFirst({
    where: { projectId, status: "completed", id: { not: scanId } },
    orderBy: { finishedAt: "desc" },
    include: { findings: true },
  });
  const previousSerious = new Set(
    (previous?.findings ?? [])
      .filter((finding) => finding.severity === "critical" || finding.severity === "high")
      .map((finding) => finding.checkId),
  );
  const fresh = checkIds.filter((checkId) => {
    const severity = getCheck(checkId).severity;
    return (severity === "critical" || severity === "high") && !previousSerious.has(checkId);
  });
  if (fresh.length === 0) return;
  const host = new URL(targetUrl).host;
  const message = `A monitored scan of ${host} found ${fresh.length} new high-severity issue${fresh.length === 1 ? "" : "s"}. Open the latest scan to review them.`;
  await prisma.alert.create({ data: { userId, scanId, message } });
  const link = `${process.env.APP_URL || "http://localhost:3000"}/scans/${scanId}`;
  await sendEmail(email, "VibeCheck found new high-severity issues", `${message}\n\n${link}`);
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
