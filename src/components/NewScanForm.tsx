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

interface AccountDraft {
  label: "A" | "B";
  mode: "password" | "session";
  loginUrl: string;
  username: string;
  password: string;
  cookie: string;
  bearerToken: string;
}

export function NewScanForm({
  initialUrl = "",
  initialMode = "full",
  lockMode = false,
  reportCredits,
  rescanCredits,
  monitoring = false,
}: {
  initialUrl?: string;
  initialMode?: "full" | "mini";
  lockMode?: boolean;
  reportCredits: number;
  rescanCredits: number;
  monitoring?: boolean;
}) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const [mode, setMode] = useState<"full" | "mini">(initialMode);
  const [use, setUse] = useState<"teaser" | "credit" | "rescan">("teaser");
  const [consent, setConsent] = useState(false);
  const [proof, setProof] = useState<Proof | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authConsent, setAuthConsent] = useState(false);
  const [accounts, setAccounts] = useState<AccountDraft[]>([emptyAccount("A"), emptyAccount("B")]);

  const paid = monitoring || (mode === "full" && (use === "credit" || use === "rescan"));

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
    setAccounts((current) => current.map((account) => (account.loginUrl ? account : { ...account, loginUrl: `${data.origin}/login` })));
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

  function authBody() {
    if (!authEnabled || !paid || mode !== "full") return undefined;
    const filled = accounts
      .map((account) => ({
        label: account.label,
        loginUrl: account.loginUrl.trim(),
        username: account.mode === "password" ? account.username.trim() : "",
        password: account.mode === "password" ? account.password : "",
        cookie: account.mode === "session" ? account.cookie.trim() : "",
        bearerToken: account.mode === "session" ? account.bearerToken.trim() : "",
      }))
      .filter((account) => (account.username && account.password) || account.cookie || account.bearerToken);
    return { consent: authConsent, accounts: filled };
  }

  async function startScan() {
    if (!proof) return;
    const auth = authBody();
    if (authEnabled && paid) {
      if (!auth || auth.accounts.length === 0) {
        setError("Add a throwaway test account, or turn off signed-in checks.");
        return;
      }
      if (!authConsent) {
        setError("Confirm these are throwaway test accounts before the scan starts.");
        return;
      }
    }
    setBusy(true);
    setError("");
    const response = await fetch(`/api/projects/${proof.projectId}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ consent, mode, use: mode === "mini" ? "teaser" : use, ...(auth ? { auth } : {}) }),
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
        {mode === "full" && !monitoring ? (
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
        {mode === "full" && !paid ? <p className="text-sm text-[#44554c]">Logged-in checks are available in the full report.</p> : null}
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
      {mode === "full" && paid ? (
        <section className="space-y-3 rounded-2xl bg-white p-4">
          <label className="flex items-start gap-2 text-sm font-medium">
            <input type="checkbox" checked={authEnabled} onChange={(event) => setAuthEnabled(event.target.checked)} />
            <span>Scan behind login</span>
          </label>
          <p className="text-sm text-[#44554c]">
            Optional. Use throwaway test accounts on this app only. Never use a real customer account, your admin account, or a password you use anywhere else. VibeCheck encrypts these values and deletes them when the scan finishes, or within 24 hours. Checks stay read-only.
          </p>
          {authEnabled ? (
            <>
              {accounts.map((account, index) => (
                <AccountFields
                  key={account.label}
                  account={account}
                  onChange={(next) => setAccounts((current) => current.map((item, itemIndex) => (itemIndex === index ? next : item)))}
                />
              ))}
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={authConsent} onChange={(event) => setAuthConsent(event.target.checked)} />
                <span>I confirm these are throwaway test accounts I created for this scan, and I authorize read-only checks while signed in as them.</span>
              </label>
            </>
          ) : null}
        </section>
      ) : mode === "full" ? (
        <p className="rounded-2xl bg-white px-4 py-3 text-sm text-[#44554c]">Logged-in checks are available in the full report.</p>
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

function AccountFields({ account, onChange }: { account: AccountDraft; onChange: (account: AccountDraft) => void }) {
  return (
    <fieldset className="space-y-2 rounded-2xl border border-[#e4e0d4] p-3 text-sm">
      <legend className="px-1 font-semibold">Test account {account.label}</legend>
      <label className="block">
        Login URL
        <input className="field mt-1" value={account.loginUrl} onChange={(event) => onChange({ ...account, loginUrl: event.target.value })} placeholder="https://my-app.example/login" autoComplete="off" />
      </label>
      <div className="flex gap-3">
        <label className="flex gap-2">
          <input type="radio" name={`auth-mode-${account.label}`} checked={account.mode === "password"} onChange={() => onChange({ ...account, mode: "password" })} />
          Username and password
        </label>
        <label className="flex gap-2">
          <input type="radio" name={`auth-mode-${account.label}`} checked={account.mode === "session"} onChange={() => onChange({ ...account, mode: "session" })} />
          Session cookie or bearer token
        </label>
      </div>
      {account.mode === "password" ? (
        <>
          <label className="block">
            Username or email
            <input className="field mt-1" value={account.username} onChange={(event) => onChange({ ...account, username: event.target.value })} autoComplete="off" />
          </label>
          <label className="block">
            Password
            <input className="field mt-1" type="password" value={account.password} onChange={(event) => onChange({ ...account, password: event.target.value })} autoComplete="new-password" />
          </label>
        </>
      ) : (
        <>
          <label className="block">
            Session cookie
            <input className="field mt-1" value={account.cookie} onChange={(event) => onChange({ ...account, cookie: event.target.value })} autoComplete="off" placeholder="session=..." />
          </label>
          <label className="block">
            Bearer token
            <input className="field mt-1" value={account.bearerToken} onChange={(event) => onChange({ ...account, bearerToken: event.target.value })} autoComplete="off" />
          </label>
          <p className="text-[#44554c]">Use this for an app that signs in with 2FA or a social login. Paste the cookie or token from the throwaway account.</p>
        </>
      )}
    </fieldset>
  );
}

function emptyAccount(label: "A" | "B"): AccountDraft {
  return { label, mode: "password", loginUrl: "", username: "", password: "", cookie: "", bearerToken: "" };
}
