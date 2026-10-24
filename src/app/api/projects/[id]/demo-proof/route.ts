import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { safeFetch } from "@/lib/http";
import { isLocalDemoUrl } from "@/lib/ownership";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (process.env.ALLOW_LOCAL_TARGETS !== "true") {
    return NextResponse.json({ error: "Local demo installs are disabled." }, { status: 403 });
  }
  const { id } = await context.params;
  const project = await prisma.project.findFirst({ where: { id, userId: user.id } });
  if (!project || !isLocalDemoUrl(project.url)) {
    return NextResponse.json({ error: "That origin is not a local demo target." }, { status: 400 });
  }
  const response = await safeFetch({
    url: `${project.url}/_demo/install-proof`,
    targetOrigin: project.url,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: project.ownershipToken }),
    follow: false,
  });
  if (response.status !== 200) return NextResponse.json({ error: "The demo target did not accept the proof." }, { status: 502 });
  return NextResponse.json({ ok: true });
}
