"use client";

import { useState } from "react";

export function SharePanel({ scanId, enabled, token }: { scanId: string; enabled: boolean; token: string | null }) {
  const [on, setOn] = useState(enabled);
  const [shareToken, setShareToken] = useState(token);
  const [error, setError] = useState("");

  async function toggle(next: boolean) {
    setError("");
    const response = await fetch(`/api/scans/${scanId}/share`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
    const data = (await response.json()) as { error?: string; token?: string; enabled?: boolean };
    if (!response.ok) {
      setError(data.error || "Could not update sharing.");
      return;
    }
    setOn(Boolean(data.enabled));
    if (data.token) setShareToken(data.token);
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const sharePath = shareToken ? `${origin}/share/${shareToken}` : "";
  const badgePath = shareToken ? `${origin}/api/badge/${shareToken}` : "";

  return (
    <section className="rounded-3xl border border-black/10 bg-white p-5 text-ink">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-2xl">Public score</h3>
          <p className="text-sm text-[#536058]">The public page and badge show the score and scan date only. Finding details stay private.</p>
        </div>
        <button className="btn btn-ink" type="button" onClick={() => toggle(!on)}>
          {on ? "Turn off sharing" : "Enable sharing"}
        </button>
      </div>
      {on && shareToken ? (
        <div className="mt-4 space-y-2 text-sm">
          <p>
            Share page:{" "}
            <a className="underline" href={sharePath}>
              {sharePath}
            </a>
          </p>
          <p className="break-all">
            Badge: <code>{badgePath}</code>
          </p>
          <pre className="overflow-auto rounded-xl bg-[#14201b] p-3 text-xs text-[#f4f0e6]">{`<img src="${badgePath}" alt="VibeCheck score" />`}</pre>
        </div>
      ) : null}
      {error ? <p className="mt-2 text-sm text-[#8a2d18]">{error}</p> : null}
    </section>
  );
}
