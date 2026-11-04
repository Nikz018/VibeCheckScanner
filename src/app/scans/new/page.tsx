import type { Metadata } from "next";
import { NewScanForm } from "@/components/NewScanForm";
import { monitoringActive } from "@/lib/entitlements";
import { requirePageUser } from "@/lib/require-user";
import { privateMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";
export const metadata: Metadata = privateMetadata("New scan");

export default async function NewScanPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const query = await searchParams;
  const returnPath = query.checkout === "success" || query.checkout === "cancel" ? `/scans/new?checkout=${query.checkout}` : "/scans/new";
  const user = await requirePageUser(returnPath);
  const monitoring = monitoringActive(user.subscription?.status);
  return (
    <div className="mx-auto max-w-3xl space-y-4 py-6">
      <h1 className="font-display text-5xl">New scan</h1>
      <p className="text-[#d9d3c5]">Enter the origin, publish the proof, and consent. Active probes start only after both checks pass.</p>
      {query.checkout === "success" ? (
        <p className="text-sm text-lime">Payment received. Use the $99 full-report credit so this scan can connect GitHub before it starts.</p>
      ) : null}
      {monitoring ? <p className="text-sm text-lime">Your monitoring subscription unlocks full reports.</p> : null}
      <NewScanForm
        reportCredits={user.reportCredits}
        codeReportCredits={user.codeReportCredits}
        rescanCredits={user.rescanCredits}
        monitoring={monitoring}
      />
    </div>
  );
}
