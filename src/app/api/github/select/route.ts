import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { projectHasPaidCodeScan, queueCodeScanForProject, saveConnectedRepo } from "@/lib/code-scan/connect";
import { resumeHeldCreditScanAfterRepo } from "@/lib/code-scan/held-scan";
import { resumeAfterRepoChoice } from "@/lib/payments/paid-full-scan";
import { canConnectRepository } from "@/lib/code-scan/gate";
import { prisma } from "@/lib/db";
import { fetchInstallationRepos, githubAppConfig, safeAppPath } from "@/lib/github/app";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  projectId: z.string().min(1),
  repoId: z.string().min(1),
  returnTo: z.string().optional(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a repository." }, { status: 400 });
  const project = await prisma.project.findFirst({
    where: { id: parsed.data.projectId, userId: user.id },
    include: { repoLink: true },
  });
  if (!project?.repoLink) return NextResponse.json({ error: "Connect GitHub first." }, { status: 404 });
  const paid = await projectHasPaidCodeScan(user.id, project.id);
  const gate = canConnectRepository({ ownershipVerified: Boolean(project.ownershipVerifiedAt), paidRescan: paid });
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 403 });
  const config = githubAppConfig();
  if (!config) return NextResponse.json({ error: "Repository connection is not available on this server yet." }, { status: 503 });
  let repos;
  try {
    repos = await fetchInstallationRepos({
      appId: config.appId,
      privateKey: config.privateKey,
      installationId: project.repoLink.installationId,
    });
  } catch (error) {
    console.error("github repo list failed", error instanceof Error ? error.message : "error");
    return NextResponse.json({ error: "GitHub could not confirm this connection. Try again." }, { status: 502 });
  }
  const repo = repos.find((item) => item.id === parsed.data.repoId);
  if (!repo) return NextResponse.json({ error: "Choose one repository this connection can read." }, { status: 400 });
  const saved = await saveConnectedRepo({
    userId: user.id,
    userEmail: user.email,
    projectId: project.id,
    targetUrl: project.url,
    installationId: project.repoLink.installationId,
    repoId: repo.id,
    owner: repo.owner,
    name: repo.name,
    defaultBranch: repo.defaultBranch,
  });
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 409 });
  const returnTo = safeAppPath(parsed.data.returnTo);
  const resume = await resumeAfterRepoChoice(user.id, project.id, returnTo);
  if (resume.kind === "later") {
    const held = await resumeHeldCreditScanAfterRepo(user.id, project.id);
    if (held) {
      return NextResponse.json({
        ok: true,
        repo: `${repo.owner}/${repo.name}`,
        scanId: held.scanId,
        redirect: `/scans/${held.scanId}`,
      });
    }
    const queued = await queueCodeScanForProject(user.id, project.id);
    return NextResponse.json({ ok: true, repo: `${repo.owner}/${repo.name}`, scanId: queued.ok ? queued.scanId : null });
  }
  return NextResponse.json({
    ok: true,
    repo: `${repo.owner}/${repo.name}`,
    scanId: resume.kind === "progress" ? resume.scanId : null,
    redirect: resume.redirect,
  });
}
