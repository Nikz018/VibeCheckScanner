import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NewScanForm } from "@/components/NewScanForm";
import { getCurrentUser } from "@/lib/auth";
import { monitoringActive } from "@/lib/entitlements";
import { privateMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";
export const metadata: Metadata = privateMetadata("New scan");

export default async function NewScanPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/scans/new");
  const query = await searchParams;
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
