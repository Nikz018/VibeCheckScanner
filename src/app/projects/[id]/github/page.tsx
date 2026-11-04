import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RepoPicker } from "@/components/RepoPicker";
import { RunCodeScanButton } from "@/components/RunCodeScanButton";
import { requirePageUser } from "@/lib/require-user";
import { CODE_SCAN_REPO_LOCK_NOTE, codeScanRepoLabel } from "@/lib/code-scan/messages";
import { CODE_PRIVACY_PROMISE } from "@/lib/code-scan/privacy";
import { prisma } from "@/lib/db";
import { fetchInstallationRepos, githubAppConfig, safeAppPath } from "@/lib/github/app";
import { privateMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";
export const metadata: Metadata = privateMetadata("Connect a repository");

export default async function GithubProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ connected?: string; github?: string; next?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const next = safeAppPath(query.next);
  const returnTo = next ? `/projects/${id}/github?next=${encodeURIComponent(next)}` : `/projects/${id}/github`;
  const user = await requirePageUser(returnTo);
  const project = await prisma.project.findFirst({
    where: { id, userId: user.id },
    include: { repoLink: true },
  });
  if (!project) notFound();
  const config = githubAppConfig();
  let repos: Array<{ id: string; owner: string; name: string }> = [];
  let listError = "";
  if (config && project.repoLink && project.repoLink.status !== "connected") {
    try {
      repos = await fetchInstallationRepos({
        appId: config.appId,
        privateKey: config.privateKey,
        installationId: project.repoLink.installationId,
      });
    } catch (error) {
      console.error("github repo list failed", error instanceof Error ? error.message : "error");
      listError = "GitHub could not confirm this connection. Try again.";
    }
  }
  const connected = project.repoLink?.status === "connected" && project.repoLink.owner && project.repoLink.name ? `${project.repoLink.owner}/${project.repoLink.name}` : null;
  const connectHref = `/api/github/connect?projectId=${project.id}${next ? `&next=${encodeURIComponent(next)}` : ""}`;
  return (
    <div className="py-8">
      <section className="panel p-6">
        <h1 className="font-display text-4xl">Connect a repository</h1>
        <p className="mt-2 text-sm text-[#e6ddd6]">{project.url}</p>
        <p className="mt-4 rounded-2xl bg-[#ff6a3d]/15 px-4 py-3 text-sm text-[#f8e6dc]">{CODE_PRIVACY_PROMISE}</p>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-[#e6ddd6]">
          <li>Pick one repository. The connection can read file contents and recent history, and it cannot change the repository.</li>
          <li>Connecting it shows you control that code. The scan still requires the ownership proof on this origin.</li>
          <li>Choose “Only select repositories” on the GitHub screen and tick a single repo.</li>
        </ul>
        {query.connected === "1" && connected ? <p className="mt-4 text-sm text-[#e6ddd6]">Connected {connected}.</p> : null}
        {query.github === "denied" ? <p className="mt-4 text-sm text-[#f3c7bc]">This origin needs a verified $99 site + code scan before a repository can be connected.</p> : null}
        {query.github === "unavailable" || !config ? <p className="mt-4 text-sm text-[#f3c7bc]">Repository connection is not available on this server yet.</p> : null}
        {query.github === "taken" ? <p className="mt-4 text-sm text-[#f3c7bc]">That repository is already connected to another project.</p> : null}
        {listError ? <p className="mt-4 text-sm text-[#f3c7bc]">{listError}</p> : null}
        {connected ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-[#e6ddd6]">{codeScanRepoLabel(connected)}</p>
            <p className="text-sm text-[#e6ddd6]">{CODE_SCAN_REPO_LOCK_NOTE}</p>
            <RunCodeScanButton projectId={project.id} />
            {config ? (
              <a className="btn btn-ghost" href={connectHref}>
                Choose a different repository
              </a>
            ) : null}
          </div>
        ) : config ? (
          <div className="mt-4">
            <a className="btn btn-lime" href={connectHref}>
              Connect GitHub
            </a>
            <RepoPicker projectId={project.id} repos={repos} returnTo={next ?? undefined} />
          </div>
        ) : null}
        <p className="mt-6 text-sm">
          {next ? (
            <Link className="underline" href={next}>
              Back to the scan step
            </Link>
          ) : (
            <Link className="underline" href="/dashboard">
              Back to the dashboard
            </Link>
          )}
        </p>
      </section>
    </div>
  );
}
