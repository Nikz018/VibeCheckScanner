"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function CodeScanRefresh({ scanId, status }: { scanId: string; status: string }) {
  const router = useRouter();
  useEffect(() => {
    if (status !== "running" && status !== "queued") return;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/scans/${scanId}`);
      if (!response.ok) return;
      const data = (await response.json()) as { codeStatus?: string | null };
      if (data.codeStatus && data.codeStatus !== "running" && data.codeStatus !== "queued") router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [router, scanId, status]);
  return null;
}
