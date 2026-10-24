import { redirect } from "next/navigation";
import { NewScanForm } from "@/components/NewScanForm";
import { getCurrentUser } from "@/lib/auth";
import { monitoringActive } from "@/lib/entitlements";

export const dynamic = "force-dynamic";

export default async function NewScanPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/scans/new");
  return (
    <div className="mx-auto max-w-3xl space-y-4 py-6">
      <h1 className="font-display text-5xl">New scan</h1>
      <p className="text-[#d9d3c5]">Enter the origin, publish the proof, and consent. Active probes start only after both checks pass.</p>
      {monitoringActive(user.subscription?.status) ? <p className="text-sm text-lime">Your monitoring subscription unlocks full reports.</p> : null}
      <NewScanForm reportCredits={user.reportCredits} rescanCredits={user.rescanCredits} />
    </div>
  );
}
