"use client";

import { useState } from "react";
import { TIERS } from "@/lib/pricing";

export function UpgradePanel({ scanId }: { scanId: string }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function checkout(tier: string) {
    setBusy(tier);
    setError("");
    const response = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tier, scanId }),
    });
    const data = (await response.json()) as { url?: string; error?: string };
    setBusy("");
    if (!response.ok || !data.url) {
      setError(data.error || "Checkout is not available yet.");
      return;
    }
    window.location.href = data.url;
  }

  return (
    <div className="rounded-3xl border border-[#ead98a] bg-[#fff7d4] p-5 text-ink">
      <h3 className="font-display text-2xl">Unlock the rest of this report</h3>
      <p className="mt-1 text-sm text-[#5c5644]">The scan already finished. Paying opens the stored findings. It does not rescan, except the rescan credit.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {Object.values(TIERS).map((tier) => (
          <button key={tier.id} className="rounded-2xl bg-white p-4 text-left shadow-sm" disabled={busy === tier.id} onClick={() => checkout(tier.id)} type="button">
            <div className="text-xs uppercase tracking-wide text-[#6d6758]">{tier.cadence}</div>
            <div className="mt-1 font-display text-3xl">{tier.priceLabel}</div>
            <div className="font-semibold">{tier.name}</div>
            <p className="mt-2 text-sm text-[#4e584f]">{tier.blurb}</p>
          </button>
        ))}
      </div>
      {error ? <p className="mt-3 text-sm text-[#8a2d18]">{error}</p> : null}
    </div>
  );
}
