"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RepoPicker({
  projectId,
  repos,
}: {
  projectId: string;
  repos: Array<{ id: string; owner: string; name: string }>;
}) {
  const router = useRouter();
  const [repoId, setRepoId] = useState(repos[0]?.id ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError("");
    const response = await fetch("/api/github/select", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, repoId }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    setBusy(false);
    if (!response.ok) {
      setError(body?.error || "That repository could not be saved.");
      return;
    }
    router.refresh();
  }

  if (repos.length === 0) return null;
  return (
    <div className="mt-4 space-y-3">
      <label className="block text-sm" htmlFor="repo">
        Choose one repository
        <select id="repo" className="mt-1 w-full rounded-xl border border-white/15 bg-[#0c1422] px-3 py-2" value={repoId} onChange={(event) => setRepoId(event.target.value)}>
          {repos.map((repo) => (
            <option key={repo.id} value={repo.id}>
              {repo.owner}/{repo.name}
            </option>
          ))}
        </select>
      </label>
      <button className="btn btn-lime" type="button" disabled={busy || !repoId} onClick={() => void save()}>
        {busy ? "Saving…" : "Use this repository"}
      </button>
      {error ? <p className="text-sm text-[#f3c7bc]">{error}</p> : null}
    </div>
  );
}
