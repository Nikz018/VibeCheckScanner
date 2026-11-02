import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { githubAppConfig, verifyGithubWebhook } from "@/lib/github/app";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const config = githubAppConfig();
  if (!config) return NextResponse.json({ error: "Webhook is not configured." }, { status: 503 });
  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyGithubWebhook(raw, signature, config.webhookSecret)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }
  const event = request.headers.get("x-github-event") || "";
  let payload: { action?: string; installation?: { id?: number }; repositories_removed?: Array<{ id?: number }> };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }
  const installationId = payload.installation?.id ? String(payload.installation.id) : "";
  if (!installationId) return NextResponse.json({ ok: true });
  if (event === "installation" && payload.action === "deleted") {
    await prisma.repoLink.deleteMany({ where: { installationId } });
  }
  if (event === "installation_repositories" && payload.action === "removed") {
    const ids = (payload.repositories_removed ?? []).map((repo) => (repo.id ? String(repo.id) : "")).filter(Boolean);
    if (ids.length > 0) {
      await prisma.repoLink.deleteMany({ where: { installationId, repoId: { in: ids } } });
    }
  }
  return NextResponse.json({ ok: true });
}
