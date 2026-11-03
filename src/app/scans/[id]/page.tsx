import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CodeScanConnectStep } from "@/components/CodeScanConnectStep";
import { OwnershipProof, RetryFullScanButton } from "@/components/PaidScanFollowup";
import { ScanPoller } from "@/components/ScanPoller";
import { CodeScanPanel } from "@/components/CodeScanPanel";
import { shouldOfferCodeRepoStep, shouldOfferCreditCodeStep } from "@/lib/code-scan/gate";
import { ReportView } from "@/components/ReportView";
import { parseCodeReport } from "@/lib/code-scan/parse";
import { combinedScores } from "@/lib/code-scan/score";
import { githubAppConfig } from "@/lib/github/app";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { monitoringActive, ownedScanAccess } from "@/lib/entitlements";
import { instructionsFor } from "@/lib/ownership";
import { collectsBillingAddress } from "@/lib/payments";
import { settlePreviewCheckout } from "@/lib/payments/confirm-purchase";
import { FULL_SCAN_PROGRESS_LABEL, FULL_SCAN_STOPPED_LABEL, RETRY_FULL_SCAN_LABEL } from "@/lib/payments/paid-scan-status";
import { signInPath } from "@/lib/checkout-path";
import { privateMetadata } from "@/lib/seo/metadata";
import { reportFromStored } from "@/lib/stored-report";

export const dynamic = "force-dynamic";
export const metadata: Metadata = privateMetadata("Scan report");

export default async function ScanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ checkout?: string; status?: string; payment_status?: string; recheck?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect(signInPath(`/scans/${id}`));
  const scan = await prisma.scan.findFirst({
    where: { id, userId: user.id },
    include: { findings: true, project: { include: { repoLink: true } } },
  });
  if (!scan) notFound();
  const purchases = await prisma.purchase.findMany({
    where: {
      userId: user.id,
      tier: { in: ["report", "rescan"] },
      OR: [{ scanId: scan.id }, { fullScanId: scan.id }],
    },
    include: { fullScan: { select: { id: true, status: true, error: true } } },
    orderBy: { createdAt: "desc" },
  });
  let purchase =
    purchases.find((row) => row.status === "paid" && row.fullScanId === scan.id) ??
    purchases.find((row) => row.status === "paid" && row.scanId === scan.id) ??
    null;
  let paymentNotice: "confirming" | "declined" | null = null;
  let paymentTier: "report" | "rescan" = "report";
  if (!purchase && scan.mode === "mini" && scan.status === "completed") {
    const latest = purchases.find((row) => row.scanId === scan.id) ?? null;
    const settled = await settlePreviewCheckout({
      purchase: latest,
      query,
    });
    paymentTier = settled.tier === "rescan" ? "rescan" : "report";
    if (settled.kind === "paid" && latest) {
      purchase = await prisma.purchase.findUnique({
        where: { id: latest.id },
        include: { fullScan: { select: { id: true, status: true, error: true } } },
      });
    } else if (settled.kind === "confirming" || settled.kind === "declined") {
      paymentNotice = settled.kind;
    }
  }
  const githubReady = githubAppConfig() !== null;
  const connectedRepo =
    scan.project.repoLink?.status === "connected" && scan.project.repoLink.owner && scan.project.repoLink.name
      ? `${scan.project.repoLink.owner}/${scan.project.repoLink.name}`
      : null;
  const creditCodeStep = shouldOfferCreditCodeStep({
    mode: scan.mode,
    codeScanEnabled: scan.codeScanEnabled,
    codeScanChoice: scan.codeScanChoice,
    status: scan.status,
    githubConfigured: githubReady,
  });
  const offerCodeStep = Boolean(
    creditCodeStep ||
      (purchase &&
        scan.mode === "mini" &&
        shouldOfferCodeRepoStep({
          tier: purchase.tier,
          ownershipVerified: Boolean(scan.project.ownershipVerifiedAt),
          githubConfigured: githubReady,
          fullScanStarted: Boolean(purchase.fullScanId),
          codeScanChoice: purchase.codeScanChoice,
        })),
  );
  const paidFullScan = purchase?.fullScanId === scan.id;
  const purchased =
    purchase?.status === "paid" ||
    purchases.some((row) => row.status === "paid" && (row.scanId === scan.id || row.fullScanId === scan.id));
  const gating = ownedScanAccess({
    mode: scan.mode,
    reportAccess: scan.reportAccess,
    subscriber: monitoringActive(user.subscription?.status),
    purchased,
  });
  if (scan.status !== "completed") {
    if (creditCodeStep) {
      return (
        <div className="space-y-4 py-8">
          <CodeScanConnectStep scanId={scan.id} projectId={scan.projectId} repo={connectedRepo} returnPath={`/scans/${scan.id}`} />
        </div>
      );
    }
    const proof = instructionsFor(scan.project.url, scan.project.ownershipToken);
    return (
      <div className="space-y-4 py-8">
        <ScanPoller
          scanId={scan.id}
          initialStatus={scan.status}
          initialError={scan.error}
          mode={scan.mode}
          initialStage={scan.progressStage}
          initialPages={scan.pagesDiscovered}
          initialStartedAt={scan.startedAt?.toISOString() ?? null}
          initialCreatedAt={scan.createdAt.toISOString()}
          codeScan={Boolean(scan.codeScanEnabled && connectedRepo)}
          progressTitle={paidFullScan ? FULL_SCAN_PROGRESS_LABEL : undefined}
          stoppedTitle={paidFullScan ? FULL_SCAN_STOPPED_LABEL : undefined}
        />
        {paidFullScan && purchase && scan.status === "failed" ? (
          <section className="paper rounded-3xl p-6 text-ink">
            <h2 className="font-display text-3xl">{FULL_SCAN_STOPPED_LABEL}</h2>
            <p className="mt-2 text-sm text-[#44554c]">Retry runs this paid scan again. It does not charge you again.</p>
            <OwnershipProof instructions={{ token: proof.token, wellKnownUrl: proof.wellKnownUrl, dnsHost: proof.dnsHost, dnsValue: proof.dnsValue }} />
            <RetryFullScanButton purchaseId={purchase.id} label={RETRY_FULL_SCAN_LABEL} />
          </section>
        ) : null}
      </div>
    );
  }
  const proof = instructionsFor(scan.project.url, scan.project.ownershipToken);
  const codeReport = scan.codeScanEnabled ? parseCodeReport(scan.codeReport) : null;
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
  return (
    <div className="space-y-6 py-6">
      {offerCodeStep && purchase ? (
        <CodeScanConnectStep purchaseId={purchase.id} projectId={scan.projectId} repo={connectedRepo} returnPath={`/scans/${scan.id}?checkout=success`} />
      ) : null}
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
        paymentNotice={paymentNotice}
        paymentTier={paymentTier}
        recheck={query.recheck === "1"}
        scores={
          !gating.upsell
            ? combinedScores({ codeScanEnabled: scan.codeScanEnabled, siteScore: report.score, codeReport })
            : null
        }
        codeScan={
          scan.codeScanEnabled && scan.reportAccess === "full" && !gating.upsell ? (
            <CodeScanPanel
              scanId={scan.id}
              projectId={scan.projectId}
              report={codeReport}
              repo={
                scan.project.repoLink?.status === "connected" && scan.project.repoLink.owner
                  ? `${scan.project.repoLink.owner}/${scan.project.repoLink.name}`
                  : null
              }
              ownershipVerified={Boolean(scan.project.ownershipVerifiedAt)}
              githubReady={githubReady}
            />
          ) : null
        }
        paidFollowup={
          scan.mode === "mini" && purchase && !offerCodeStep
            ? {
                purchaseId: purchase.id,
                ownershipBlock: purchase.ownershipBlock,
                startNote: purchase.startNote,
                fullScan: purchase.fullScan,
                instructions:
                  purchase.ownershipBlock || purchase.fullScan?.status === "failed"
                    ? { token: proof.token, wellKnownUrl: proof.wellKnownUrl, dnsHost: proof.dnsHost, dnsValue: proof.dnsValue }
                    : null,
              }
            : null
        }
      />
    </div>
  );
}
