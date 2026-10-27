"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CHECK_OWNERSHIP_LABEL,
  FULL_SCAN_PROGRESS_LABEL,
  FULL_SCAN_STOPPED_LABEL,
  OPEN_FULL_REPORT_LABEL,
  RETRY_FULL_SCAN_LABEL,
  START_FULL_SCAN_LABEL,
} from "@/lib/payments/paid-scan-status";

export interface PaidOwnershipInstructions {
  token: string;
  wellKnownUrl: string;
  dnsHost: string;
  dnsValue: string;
}

export interface PaidScanFollowupState {
  purchaseId: string;
  ownershipBlock: string | null;
  startNote: string | null;
  fullScan: { id: string; status: string; error: string | null } | null;
  instructions: PaidOwnershipInstructions | null;
}

export function PaidScanFollowup({ followup, pending = false }: { followup: PaidScanFollowupState | null; pending?: boolean }) {
  if (!followup) {
    return pending ? <PaymentPending /> : null;
  }
  const scan = followup.fullScan;
  if (scan && (scan.status === "queued" || scan.status === "running")) {
    return (
      <section className="rounded-3xl border border-lime/40 bg-lime/10 p-5">
        <h2 className="font-display text-3xl">{FULL_SCAN_PROGRESS_LABEL}</h2>
        <p className="mt-3 text-sm text-[#d9d3c5]">Ownership was checked again. The full scan is running every check on this origin.</p>
        <a className="btn btn-lime mt-4" href={`/scans/${scan.id}`}>
          Open the status page
        </a>
      </section>
    );
  }
  if (scan && scan.status === "completed") {
    return (
      <section className="rounded-3xl border border-lime/40 bg-lime/10 p-5">
        <h2 className="font-display text-3xl">Full report ready</h2>
        <p className="mt-3 text-sm text-[#d9d3c5]">The paid scan finished. The free preview above is unchanged.</p>
        <a className="btn btn-lime mt-4" href={`/scans/${scan.id}`}>
          {OPEN_FULL_REPORT_LABEL}
        </a>
      </section>
    );
  }
  if (scan && scan.status === "failed") {
    return (
      <section className="rounded-3xl border border-[#f3c7bc]/50 bg-[#f3c7bc]/10 p-5">
        <h2 className="font-display text-3xl">{FULL_SCAN_STOPPED_LABEL}</h2>
        <p className="mt-3 text-sm text-[#d9d3c5]">{scan.error || "The full scan did not finish."}</p>
        <p className="mt-2 text-sm text-[#d9d3c5]">Retry runs the same paid scan again. It does not charge you again.</p>
        {followup.instructions ? <OwnershipProof instructions={followup.instructions} /> : null}
        <RetryFullScanButton purchaseId={followup.purchaseId} label={RETRY_FULL_SCAN_LABEL} />
      </section>
    );
  }
  if (followup.ownershipBlock) {
    return (
      <section id="upgrade" className="rounded-3xl border border-[#f8d7a8]/50 bg-[#f8d7a8]/10 p-5">
        <h2 className="font-display text-3xl">Re-verify ownership</h2>
        <p className="mt-3 text-sm text-[#d9d3c5]">{followup.ownershipBlock}</p>
        <p className="mt-2 text-sm text-[#d9d3c5]">The paid scan has not started. Publish the proof, then check it again. This does not charge you again.</p>
        {followup.instructions ? <OwnershipProof instructions={followup.instructions} /> : null}
        <RetryFullScanButton purchaseId={followup.purchaseId} label={CHECK_OWNERSHIP_LABEL} />
      </section>
    );
  }
  return (
    <section className="rounded-3xl border border-lime/40 bg-lime/10 p-5">
      <h2 className="font-display text-3xl">{followup.startNote ? START_FULL_SCAN_LABEL : FULL_SCAN_PROGRESS_LABEL}</h2>
      <p className="mt-3 text-sm text-[#d9d3c5]">{followup.startNote || "Payment is confirmed. The full scan will start shortly."}</p>
      <RetryFullScanButton purchaseId={followup.purchaseId} label={START_FULL_SCAN_LABEL} />
    </section>
  );
}

export function OwnershipProof({ instructions }: { instructions: PaidOwnershipInstructions }) {
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      <article className="rounded-2xl bg-white/10 p-4 text-sm">
        <h3 className="font-semibold">DNS TXT</h3>
        <p className="mt-2">Host: {instructions.dnsHost}</p>
        <p className="mt-1 break-all">Value: {instructions.dnsValue}</p>
      </article>
      <article className="rounded-2xl bg-white/10 p-4 text-sm">
        <h3 className="font-semibold">Well-known file</h3>
        <p className="mt-2 break-all">URL: {instructions.wellKnownUrl}</p>
        <p className="mt-1 break-all">Body: {instructions.token}</p>
      </article>
    </div>
  );
}

export function RetryFullScanButton({ purchaseId, label }: { purchaseId: string; label: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function retry() {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/purchases/${purchaseId}/retry`, { method: "POST" });
    const data = (await response.json().catch(() => null)) as { error?: string; scanId?: string } | null;
    setBusy(false);
    if (!response.ok) setError(data?.error || "The full scan could not start.");
    if (data?.scanId) {
      router.push(`/scans/${data.scanId}`);
      router.refresh();
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-4">
      <button className="btn btn-lime" type="button" disabled={busy} onClick={() => void retry()}>
        {busy ? "Checking…" : label}
      </button>
      {error ? <p className="mt-3 text-sm font-semibold">{error}</p> : null}
    </div>
  );
}

function PaymentPending() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [router]);
  return (
    <section className="rounded-3xl border border-lime/40 bg-lime/10 p-5">
      <h2 className="font-display text-3xl">{FULL_SCAN_PROGRESS_LABEL}</h2>
      <p className="mt-3 text-sm text-[#d9d3c5]">Payment received. The full scan starts when the payment is confirmed. This page updates on its own.</p>
    </section>
  );
}
