"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { progressPercent, stageState, type ScanStageId } from "@/lib/scan-progress";

interface ProgressPayload {
  status: string;
  error?: string | null;
  mode?: string;
  stage?: string | null;
  pagesDiscovered?: number;
  startedAt?: string | null;
  createdAt?: string | null;
  progress?: number;
  stages?: Array<{ id: ScanStageId; label: string; state: "done" | "current" | "pending" }>;
}

export function ScanPoller({
  scanId,
  initialStatus,
  initialError,
  mode = "full",
  initialStage = null,
  initialPages = 0,
  initialStartedAt = null,
  initialCreatedAt = null,
  progressTitle = "Scan in progress",
  stoppedTitle = "Scan stopped",
}: {
  scanId: string;
  initialStatus: string;
  initialError?: string | null;
  mode?: string;
  initialStage?: string | null;
  initialPages?: number;
  initialStartedAt?: string | null;
  initialCreatedAt?: string | null;
  progressTitle?: string;
  stoppedTitle?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState(initialError || "");
  const [stage, setStage] = useState(initialStage);
  const [pages, setPages] = useState(initialPages);
  const [startedAt, setStartedAt] = useState(initialStartedAt);
  const [scanMode, setScanMode] = useState(mode);
  const [elapsed, setElapsed] = useState(0);
  const [retryError, setRetryError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === "completed" || status === "failed") return;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/scans/${scanId}`);
      if (!response.ok) return;
      const data = (await response.json()) as ProgressPayload;
      setStatus(data.status);
      if (data.error) setError(data.error);
      if (data.stage !== undefined) setStage(data.stage);
      if (typeof data.pagesDiscovered === "number") setPages(data.pagesDiscovered);
      if (data.startedAt) setStartedAt(data.startedAt);
      if (data.mode) setScanMode(data.mode);
      if (data.status === "completed" || data.status === "failed") router.refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [router, scanId, status]);

  useEffect(() => {
    const origin = startedAt || initialCreatedAt;
    if (!origin || status === "completed") return;
    const tick = () => setElapsed(Math.max(0, Date.now() - new Date(origin).getTime()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [startedAt, initialCreatedAt, status]);

  async function retry() {
    setBusy(true);
    setRetryError("");
    const response = await fetch(`/api/scans/${scanId}/retry`, { method: "POST" });
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    setBusy(false);
    if (!response.ok) {
      setRetryError(data?.error || "The scan could not be retried.");
      return;
    }
    setStatus("queued");
    setError("");
    setStage(null);
    setPages(0);
    router.refresh();
  }

  const failed = status === "failed";
  const stages = stageState({ mode: scanMode, stage, status });
  const percent = progressPercent({ mode: scanMode, stage, status });
  const showPages = pages > 0 || stages.some((item) => item.id === "discover" && item.state !== "pending");

  return (
    <div className="paper rounded-3xl p-8 text-ink">
      <p className="text-xs uppercase tracking-[0.2em] text-[#6d6758]">Scan {scanId.slice(0, 8)}</p>
      <h1 className="mt-2 font-display text-4xl">{failed ? stoppedTitle : status === "completed" ? "Opening the report" : progressTitle}</h1>
      <p className="mt-3 max-w-xl text-[#3f4c45]">
        {failed
          ? error || "The scan did not finish."
          : status === "completed"
            ? "The report is ready."
            : "This page follows the scan as each stage finishes."}
      </p>
      <div className="mt-6" aria-hidden={failed ? undefined : undefined}>
        <div className="flex items-center justify-between text-sm text-[#3f4c45]">
          <span>{failed ? "Stopped" : `${percent}%`}</span>
          <span>Elapsed {formatElapsed(elapsed)}</span>
        </div>
        <div className="scan-progress mt-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Scan progress">
          <span className={failed ? "" : "scan-progress-live"} style={{ width: `${percent}%` }} />
        </div>
      </div>
      <ol className="mt-6 space-y-2" aria-label="Scan stages">
        {stages.map((item) => (
          <li key={item.id} className="flex items-center gap-3 text-sm" aria-current={item.state === "current" ? "step" : undefined}>
            <span
              className={`scan-stage-mark ${item.state === "current" && !failed ? "scan-stage-current" : ""} ${item.state === "done" ? "bg-lime text-ink" : item.state === "current" ? "bg-[#14201b] text-[#f4f0e6]" : "bg-[#e7e1d4] text-[#6d6758]"}`}
              aria-hidden="true"
            >
              {item.state === "done" ? "✓" : item.state === "current" ? "•" : ""}
            </span>
            <span className={item.state === "pending" ? "text-[#6d6758]" : "font-medium"}>{item.label}</span>
          </li>
        ))}
      </ol>
      {showPages ? <p className="mt-4 text-sm text-[#3f4c45]">Pages discovered: {pages}</p> : null}
      {failed ? (
        <div className="mt-6">
          <button className="btn btn-ink" type="button" disabled={busy} onClick={() => void retry()}>
            {busy ? "Retrying…" : "Retry scan"}
          </button>
          {retryError ? (
            <p className="mt-3 text-sm text-[#8a2d18]" role="alert">
              {retryError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
