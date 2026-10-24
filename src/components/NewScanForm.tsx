"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Proof {
  projectId: string;
  origin: string;
  token: string;
  wellKnownUrl: string;
  dnsHost: string;
  verified: boolean;
  demo: boolean;
}

export function NewScanForm({
  initialUrl = "",
  initialMode = "full",
  lockMode = false,
  reportCredits,
  rescanCredits,
}: {
  initialUrl?: string;
  initialMode?: "full" | "mini";
  lockMode?: boolean;
  reportCredits: number;
  rescanCredits: number;
}) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const [mode, setMode] = useState<"full" | "mini">(initialMode);
  const [use, setUse] = useState<"teaser" | "credit" | "rescan">("teaser");
  const [consent, setConsent] = useState(false);
  const [proof, setProof] = useState<Proof | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = (await response.json()) as Proof & { error?: string };
    setBusy(false);
    if (!response.ok) {
      setError(data.error || "Could not prepare that URL.");
      return;
    }
    setProof(data);
  }

  async function installDemo() {
    if (!proof) return;
    setBusy(true);
    setError("");
    const response = await fetch(`/api/projects/${proof.projectId}/demo-proof`, { method: "POST" });
    const data = (await response.json()) as { error?: string };
    setBusy(false);
    if (!response.ok) setError(data.error || "Could not install the demo proof.");
  }

  async function startScan() {
    if (!proof) return;
    setBusy(true);
    setError("");
    const response = await fetch(`/api/projects/${proof.projectId}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ consent, mode, use: mode === "mini" ? "teaser" : use }),
    });
    const data = (await response.json()) as { error?: string; scanId?: string };
    setBusy(false);
    if (!response.ok || !data.scanId) {
      setError(data.error || "Ownership was not confirmed.");
      return;
    }
    router.push(`/scans/${data.scanId}`);
  }

  if (!proof) {
    return (
      <form onSubmit={createProject} className="paper space-y-4 rounded-3xl p-6 text-ink">
        <label className="block text-sm font-medium">
          App URL
          <input className="field mt-1" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://my-app.example" />
        </label>
        <fieldset className="space-y-2 text-sm">
          <legend className="font-medium">Scan</legend>
          <label className="flex gap-2">
            <input type="radio" name="mode" checked={mode === "full"} disabled={lockMode && initialMode !== "full"} onChange={() => setMode("full")} />
            Full launch scan
          </label>
          <label className="flex gap-2">
            <input type="radio" name="mode" checked={mode === "mini"} disabled={lockMode && initialMode !== "mini"} onChange={() => setMode("mini")} />
            Free mini check (headers and public files only)
          </label>
        </fieldset>
        {mode === "full" ? (
          <label className="block text-sm">
            Report access
            <select className="field mt-1" value={use} onChange={(event) => setUse(event.target.value as typeof use)}>
              <option value="teaser">Free teaser</option>
              <option value="credit" disabled={reportCredits < 1}>
                Use a full-report credit ({reportCredits} left)
              </option>
              <option value="rescan" disabled={rescanCredits < 1}>
                Use a rescan credit ({rescanCredits} left)
              </option>
            </select>
          </label>
        ) : null}
        {error ? <p className="text-sm text-[#8a2d18]">{error}</p> : null}
        <button className="btn btn-ink" disabled={busy} type="submit">
          {busy ? "Checking…" : "Continue"}
        </button>
      </form>
    );
  }

  return (
    <div className="paper space-y-4 rounded-3xl p-6 text-ink">
      <h2 className="font-display text-3xl">Prove you own {proof.origin}</h2>
      <p className="text-sm text-[#44554c]">
        {proof.verified
          ? "This origin was verified before. We check the proof again before probes start."
          : "Publish one of these proofs. Nothing active runs until it matches and you consent."}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <article className="rounded-2xl bg-white p-4 text-sm">
          <h3 className="font-semibold">DNS TXT</h3>
          <p className="mt-2">Host: {proof.dnsHost}</p>
          <p className="mt-1 break-all">Value: {proof.token}</p>
        </article>
        <article className="rounded-2xl bg-white p-4 text-sm">
          <h3 className="font-semibold">Well-known file</h3>
          <p className="mt-2 break-all">URL: {proof.wellKnownUrl}</p>
          <p className="mt-1 break-all">Body: {proof.token}</p>
        </article>
      </div>
      {proof.demo ? (
        <button className="btn btn-ghost-ink" type="button" onClick={installDemo} disabled={busy}>
          Install proof on this local demo
        </button>
      ) : null}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        <span>I own or am authorized to test this application, and I agree to a non-destructive scan. The result is a point-in-time report, not a guarantee or a certification.</span>
      </label>
      {error ? <p className="text-sm text-[#8a2d18]">{error}</p> : null}
      <button className="btn btn-ink" type="button" disabled={busy || !consent} onClick={startScan}>
        {busy ? "Verifying…" : mode === "mini" ? "Verify and run mini check" : "Verify and start scan"}
      </button>
    </div>
  );
}
