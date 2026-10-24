"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function ScanPoller({ scanId, initialStatus, initialError }: { scanId: string; initialStatus: string; initialError?: string | null }) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState(initialError || "");

  useEffect(() => {
    if (status === "completed" || status === "failed") return;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/scans/${scanId}`);
      if (!response.ok) return;
      const data = (await response.json()) as { status: string; error?: string | null };
      setStatus(data.status);
      if (data.error) setError(data.error);
      if (data.status === "completed" || data.status === "failed") {
        router.refresh();
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [router, scanId, status]);

  return (
    <div className="paper rounded-3xl p-8 text-ink">
      <p className="text-xs uppercase tracking-[0.2em] text-[#6d6758]">Scan {scanId.slice(0, 8)}</p>
      <h1 className="mt-2 font-display text-4xl">{status === "failed" ? "Scan stopped" : "Scan in progress"}</h1>
      <p className="mt-3 max-w-xl text-[#3f4c45]">
        {status === "failed"
          ? error || "The scan did not finish."
          : "Ownership was checked again, then the non-destructive probes started. This page updates on its own."}
      </p>
    </div>
  );
}
