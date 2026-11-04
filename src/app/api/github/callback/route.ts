import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { signInPath } from "@/lib/checkout-path";
import { projectHasPaidCodeScan, queueCodeScanForProject, saveConnectedRepo } from "@/lib/code-scan/connect";
import { resumeHeldCreditScanAfterRepo } from "@/lib/code-scan/held-scan";
import { resumeAfterRepoChoice } from "@/lib/payments/paid-full-scan";
import { canConnectRepository } from "@/lib/code-scan/gate";
import { prisma } from "@/lib/db";
import { fetchInstallationRepos, githubAppConfig, readGithubState } from "@/lib/github/app";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await readSession();
  const url = new URL(request.url);
  const origin = (process.env.APP_URL || url.origin).replace(/\/$/, "");
  if (session.status !== "active") {
    return NextResponse.redirect(new URL(signInPath("/dashboard", { expired: session.status === "expired" }), origin));
  }
  const user = session.user;
  const secret = process.env.SESSION_SECRET?.trim() ?? "";
  const state = readGithubState(url.searchParams.get("state") || "", secret);
  if (!state || state.userId !== user.id) {
    return NextResponse.redirect(`${origin}/dashboard?github=state`);
  }
  const project = await prisma.project.findFirst({ where: { id: state.projectId, userId: user.id } });
  if (!project) return NextResponse.redirect(`${origin}/dashboard?github=missing`);
  const paid = await projectHasPaidCodeScan(user.id, project.id);
  const gate = canConnectRepository({ ownershipVerified: Boolean(project.ownershipVerifiedAt), paidRescan: paid });
  if (!gate.ok) return NextResponse.redirect(githubReturn(origin, project.id, { github: "denied" }, state.next));
  const installationId = url.searchParams.get("installation_id") || "";
  const config = githubAppConfig();
  if (!config || !installationId) return NextResponse.redirect(githubReturn(origin, project.id, { github: "unavailable" }, state.next));

  await prisma.repoLink.upsert({
    where: { projectId: project.id },
    update: { installationId, status: "pending", userId: user.id },
    create: { projectId: project.id, userId: user.id, installationId, status: "pending" },
  });

  try {
    const repos = await fetchInstallationRepos({
      appId: config.appId,
      privateKey: config.privateKey,
      installationId,
    });
    if (repos.length === 1) {
      const repo = repos[0];
      const saved = await saveConnectedRepo({
        userId: user.id,
        userEmail: user.email,
        projectId: project.id,
        targetUrl: project.url,
        installationId,
        repoId: repo.id,
        owner: repo.owner,
        name: repo.name,
        defaultBranch: repo.defaultBranch,
      });
      if (!saved.ok) return NextResponse.redirect(githubReturn(origin, project.id, { github: "taken" }, state.next));
      return NextResponse.redirect(await redirectAfterRepoSave(origin, user.id, project.id, state.next));
    }
  } catch (error) {
    console.error("github callback failed", error instanceof Error ? error.message : "error");
    return NextResponse.redirect(githubReturn(origin, project.id, { github: "unavailable" }, state.next));
  }
  return NextResponse.redirect(githubReturn(origin, project.id, {}, state.next));
}

function githubReturn(origin: string, projectId: string, params: Record<string, string>, next: string | null): string {
  const url = new URL(`${origin}/projects/${projectId}/github`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (next) url.searchParams.set("next", next);
  return url.toString();
}

async function redirectAfterRepoSave(origin: string, userId: string, projectId: string, next: string | null): Promise<string> {
  const resume = await resumeAfterRepoChoice(userId, projectId, next);
  if (resume.kind !== "later") {
    return `${origin}${resume.redirect.startsWith("/") ? resume.redirect : `/${resume.redirect}`}`;
  }
  const held = await resumeHeldCreditScanAfterRepo(userId, projectId);
  if (held) return `${origin}/scans/${held.scanId}`;
  await queueCodeScanForProject(userId, projectId).catch(() => undefined);
  return `${origin}/projects/${projectId}/github?connected=1`;
}
