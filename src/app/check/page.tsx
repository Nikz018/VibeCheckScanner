import { redirect } from "next/navigation";
import { NewScanForm } from "@/components/NewScanForm";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CheckPage({ searchParams }: { searchParams: Promise<{ url?: string }> }) {
  const user = await getCurrentUser();
  const params = await searchParams;
  if (!user) redirect(`/login?next=${encodeURIComponent(params.url ? `/check?url=${params.url}` : "/check")}`);
  return (
    <div className="mx-auto max-w-3xl space-y-4 py-6">
      <h1 className="font-display text-5xl">Mini check</h1>
      <p className="text-[#d9d3c5]">
        A free look at security headers and common public files. You still prove ownership and consent. The report will not claim the other families ran.
      </p>
      <NewScanForm initialUrl={params.url || ""} initialMode="mini" lockMode reportCredits={user.reportCredits} rescanCredits={user.rescanCredits} />
    </div>
  );
}
