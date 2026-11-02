import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { projectHasPaidCodeScan, queueCodeScanForProject, saveConnectedRepo } from "@/lib/code-scan/connect";
import { canConnectRepository } from "@/lib/code-scan/gate";
import { prisma } from "@/lib/db";
import { fetchInstallationRepos, githubAppConfig, readGithubState } from "@/lib/github/app";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  const url = new URL(request.url);
  const origin = (process.env.APP_URL || url.origin).replace(/\/$/, "");
  if (!user) return NextResponse.redirect(`${origin}/login?next=/dashboard`);
  const secret = process.env.SESSION_SECRET?.trim() ?? "";
  const state = readGithubState(url.searchParams.get("state") || "", secret);
  if (!state || state.userId !== user.id) {
    return NextResponse.redirect(`${origin}/dashboard?github=state`);
  }
  const project = await prisma.project.findFirst({ where: { id: state.projectId, userId: user.id } });
  if (!project) return NextResponse.redirect(`${origin}/dashboard?github=missing`);
  const paid = await projectHasPaidCodeScan(user.id, project.id);
  const gate = canConnectRepository({ ownershipVerified: Boolean(project.ownershipVerifiedAt), paidRescan: paid });
  if (!gate.ok) return NextResponse.redirect(`${origin}/projects/${project.id}/github?github=denied`);
  const installationId = url.searchParams.get("installation_id") || "";
  const config = githubAppConfig();
  if (!config || !installationId) return NextResponse.redirect(`${origin}/projects/${project.id}/github?github=unavailable`);

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
      if (!saved.ok) return NextResponse.redirect(`${origin}/projects/${project.id}/github?github=taken`);
      await queueCodeScanForProject(user.id, project.id).catch(() => undefined);
      return NextResponse.redirect(`${origin}/projects/${project.id}/github?connected=1`);
    }
  } catch (error) {
    console.error("github callback failed", error instanceof Error ? error.message : "error");
    return NextResponse.redirect(`${origin}/projects/${project.id}/github?github=unavailable`);
  }
  return NextResponse.redirect(`${origin}/projects/${project.id}/github`);
}
