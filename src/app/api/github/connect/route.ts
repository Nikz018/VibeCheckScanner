import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canConnectRepository } from "@/lib/code-scan/gate";
import { projectHasPaidCodeScan } from "@/lib/code-scan/connect";
import { prisma } from "@/lib/db";
import { githubAppConfig, githubInstallUrl, safeAppPath, signGithubState } from "@/lib/github/app";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const projectId = new URL(request.url).searchParams.get("projectId") || "";
  const project = projectId ? await prisma.project.findFirst({ where: { id: projectId, userId: user.id } }) : null;
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const paid = await projectHasPaidCodeScan(user.id, project.id);
  const gate = canConnectRepository({ ownershipVerified: Boolean(project.ownershipVerifiedAt), paidRescan: paid });
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 403 });
  const config = githubAppConfig();
  const secret = process.env.SESSION_SECRET?.trim() ?? "";
  if (!config || secret.length < 16) {
    return NextResponse.json({ error: "Repository connection is not available on this server yet." }, { status: 503 });
  }
  const next = safeAppPath(new URL(request.url).searchParams.get("next"));
  const state = signGithubState({ projectId: project.id, userId: user.id, next }, secret);
  return NextResponse.redirect(githubInstallUrl(config.slug, state));
}
