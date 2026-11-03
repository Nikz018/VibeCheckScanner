"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CODE_PRIVACY_PROMISE } from "@/lib/code-scan/privacy";
import {
  CHANGE_REPO_LABEL,
  CODE_REPO_STEP_TITLE,
  SKIP_CODE_SCAN_LABEL,
  USE_THIS_REPO_LABEL,
} from "@/lib/payments/paid-scan-status";

export function CodeScanConnectStep({
  purchaseId,
  scanId,
  projectId,
  repo,
  returnPath,
}: {
  purchaseId?: string;
  scanId?: string;
  projectId: string;
  repo: string | null;
  returnPath: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"skip" | "connect" | null>(null);
  const [error, setError] = useState("");
  const connectHref = `/api/github/connect?projectId=${encodeURIComponent(projectId)}&next=${encodeURIComponent(returnPath)}`;
  const endpoint = scanId ? `/api/scans/${scanId}/code-choice` : `/api/purchases/${purchaseId}/retry`;

  async function choose(choice: "skip" | "connect") {
    setBusy(choice);
    setError("");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ choice }),
    });
    const data = (await response.json().catch(() => null)) as { error?: string; scanId?: string } | null;
    setBusy(null);
    if (!response.ok || !data?.scanId) {
      setError(data?.error || "The scan could not start.");
      router.refresh();
      return;
    }
    router.push(`/scans/${data.scanId}`);
    router.refresh();
  }

  return (
    <section id="code-scan-step" className="rounded-3xl border border-lime/40 bg-lime/10 p-5">
      <h2 className="font-display text-3xl">{CODE_REPO_STEP_TITLE}</h2>
      <p className="mt-3 rounded-2xl bg-[#dff25b]/15 px-4 py-3 text-sm text-[#e7f6c8]">{CODE_PRIVACY_PROMISE}</p>
      {repo ? <p className="mt-3 text-sm text-[#d9d3c5]">Repository: {repo}</p> : null}
      <div className="mt-4 flex flex-wrap gap-3">
        {repo ? (
          <>
            <button className="btn btn-lime" type="button" disabled={busy !== null} onClick={() => void choose("connect")}>
              {busy === "connect" ? "Starting…" : USE_THIS_REPO_LABEL}
            </button>
            <a className="btn btn-ghost" href={connectHref}>
              {CHANGE_REPO_LABEL}
            </a>
          </>
        ) : (
          <a className="btn btn-lime" href={connectHref}>
            Connect GitHub
          </a>
        )}
      </div>
      <button className="btn btn-ghost mt-4" type="button" disabled={busy !== null} onClick={() => void choose("skip")}>
        {busy === "skip" ? "Starting…" : SKIP_CODE_SCAN_LABEL}
      </button>
      {error ? <p className="mt-3 text-sm font-semibold">{error}</p> : null}
    </section>
  );
}
