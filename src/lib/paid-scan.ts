import { NextResponse } from "next/server";
import { getCurrentUser } from "./auth";
import { downloadAccess } from "./download";
import { prisma } from "./db";
import { monitoringActive, ownedScanAccess } from "./entitlements";
import { reportFromStored } from "./stored-report";
import type { CustomerReport } from "./report";

export async function requirePaidScan(scanId: string): Promise<
  | { ok: true; targetUrl: string; report: CustomerReport }
  | { ok: false; response: NextResponse }
> {
  const user = await getCurrentUser();
  const scan = user
    ? await prisma.scan.findUnique({
        where: { id: scanId },
        include: { findings: true },
      })
    : null;
  const purchased = user && scan
    ? await prisma.purchase.findFirst({
        where: {
          userId: user.id,
          status: "paid",
          tier: { in: ["report", "rescan"] },
          OR: [{ scanId: scan.id }, { fullScanId: scan.id }],
        },
        select: { id: true },
      })
    : null;
  const gating = scan
    ? ownedScanAccess({
        mode: scan.mode,
        reportAccess: scan.reportAccess,
        subscriber: monitoringActive(user?.subscription?.status),
        purchased: Boolean(purchased),
      })
    : { unlock: false, upsell: true };
  const gate = downloadAccess({
    userId: user?.id ?? null,
    scan: scan ? { userId: scan.userId, reportAccess: scan.reportAccess, status: scan.status } : null,
    unlock: gating.unlock,
  });
  if (!gate.ok || !scan) {
    const status = gate.ok ? 404 : gate.status;
    const error = status === 401 ? "Sign in first." : status === 404 ? "Scan not found." : "This download is available on the unlocked report.";
    return { ok: false, response: NextResponse.json({ error }, { status }) };
  }
  const report = reportFromStored({
    scanId: scan.id,
    status: scan.status,
    mode: scan.mode,
    reportAccess: scan.reportAccess,
    finishedAt: scan.finishedAt,
    findings: scan.findings,
    coverage: scan.coverage,
    unlock: gating.unlock,
  });
  return { ok: true, targetUrl: scan.targetUrl, report };
}
