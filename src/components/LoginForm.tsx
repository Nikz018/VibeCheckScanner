"use client";

import { useState } from "react";

export function LoginForm({ nextPath, error }: { nextPath?: string; error?: string }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [devLink, setDevLink] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setDevLink("");
    const response = await fetch("/api/auth/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, next: nextPath }),
    });
    const data = (await response.json()) as { error?: string; devLink?: string };
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error || "Could not send the link.");
      return;
    }
    setMessage("Check your inbox for a sign-in link.");
    if (data.devLink) setDevLink(data.devLink);
  }

  return (
    <form onSubmit={submit} className="paper max-w-md space-y-4 rounded-3xl p-6 shadow-card">
      <div>
        <h1 className="font-display text-4xl text-ink">Sign in</h1>
        <p className="mt-2 text-sm text-[#4d5b54]">We email you a link. No password.</p>
      </div>
      {error ? <p className="rounded-xl bg-[#ffe1d6] px-3 py-2 text-sm text-[#7a2a16]">{error}</p> : null}
      <label className="block text-sm font-medium text-ink">
        Email
        <input className="field mt-1" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
      </label>
      <button className="btn btn-ink w-full" disabled={busy} type="submit">
        {busy ? "Sending…" : "Email me a link"}
      </button>
      {message ? <p className="text-sm text-[#245c40]">{message}</p> : null}
      {devLink ? (
        <p className="text-sm text-ink">
          Local development link:{" "}
          <a className="underline" href={devLink}>
            Continue sign-in
          </a>
        </p>
      ) : null}
    </form>
  );
}
