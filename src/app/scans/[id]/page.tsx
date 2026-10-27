import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ScanPoller } from "@/components/ScanPoller";
import { ReportView } from "@/components/ReportView";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { monitoringActive } from "@/lib/entitlements";
import { collectsBillingAddress } from "@/lib/payments";
import { signInPath } from "@/lib/checkout-path";
import { privateMetadata } from "@/lib/seo/metadata";
import { reportFromStored } from "@/lib/stored-report";

export const dynamic = "force-dynamic";
export const metadata: Metadata = privateMetadata("Scan report");

export default async function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(signInPath(`/scans/${id}`));
  const scan = await prisma.scan.findFirst({
    where: { id, userId: user.id },
    include: { findings: true, project: true },
  });
  if (!scan) notFound();
  if (scan.status !== "completed") {
    return (
      <div className="py-8">
        <ScanPoller scanId={scan.id} initialStatus={scan.status} initialError={scan.error} />
      </div>
    );
  }
  const report = reportFromStored({
    scanId: scan.id,
    status: scan.status,
    mode: scan.mode,
    reportAccess: scan.reportAccess,
    finishedAt: scan.finishedAt,
    findings: scan.findings,
    coverage: scan.coverage,
  });
  return (
    <div className="py-6">
      <ReportView
        report={report}
        targetLabel={scan.targetUrl}
        scanId={scan.id}
        share={{ enabled: scan.shareEnabled, token: scan.shareToken }}
        project={{
          id: scan.projectId,
          monitorEnabled: scan.project.monitorEnabled,
          monitoringAllowed: monitoringActive(user.subscription?.status),
        }}
        collectBilling={collectsBillingAddress()}
      />
    </div>
  );
}
