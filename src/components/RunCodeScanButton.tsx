"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RunCodeScanButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/projects/${projectId}/code-scan`, { method: "POST" });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    setBusy(false);
    if (!response.ok) {
      setError(body?.error || "The code scan could not start.");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <button className="btn btn-lime" type="button" disabled={busy} onClick={() => void run()}>
        {busy ? "Starting…" : "Run code scan"}
      </button>
      {error ? <p className="mt-2 text-sm text-[#f3c7bc]">{error}</p> : null}
    </div>
  );
}
