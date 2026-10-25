"use client";

import { useState } from "react";

export function CancelSubscription() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function cancel() {
    if (!window.confirm("Cancel monitoring? Full reports from the subscription stop, and scheduled rescans stop.")) return;
    setBusy(true);
    setError("");
    const response = await fetch("/api/billing/cancel", { method: "POST" });
    const data = (await response.json()) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setError(data.error || "Could not cancel the subscription.");
      return;
    }
    window.location.reload();
  }

  return (
    <div className="mt-3">
      <button className="text-sm underline" type="button" onClick={cancel} disabled={busy}>
        {busy ? "Canceling…" : "Cancel monitoring"}
      </button>
      {error ? <p className="mt-1 text-sm text-[#f0b4a8]">{error}</p> : null}
    </div>
  );
}
