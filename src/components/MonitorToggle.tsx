"use client";

import { useState } from "react";

export function MonitorToggle({ projectId, enabled, allowed }: { projectId: string; enabled: boolean; allowed: boolean }) {
  const [on, setOn] = useState(enabled);
  const [error, setError] = useState("");

  async function toggle() {
    setError("");
    const response = await fetch(`/api/projects/${projectId}/monitor`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !on }),
    });
    const data = (await response.json()) as { error?: string; enabled?: boolean };
    if (!response.ok) {
      setError(data.error || "Monitoring is not available.");
      return;
    }
    setOn(Boolean(data.enabled));
  }

  return (
    <div className="text-sm">
      <button className="btn btn-ghost-ink" type="button" onClick={toggle} disabled={!allowed && !on}>
        {on ? "Monitoring on" : "Monitor this origin"}
      </button>
      {!allowed && !on ? <p className="mt-1 text-[#6a6154]">Monitoring needs an active $29/mo subscription.</p> : null}
      {error ? <p className="mt-1 text-[#8a2d18]">{error}</p> : null}
    </div>
  );
}
