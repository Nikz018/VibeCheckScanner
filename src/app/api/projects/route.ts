import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ProbeBlockedError, assertProbeAllowed } from "@/lib/http";
import { instructionsFor, isLocalDemoUrl, newOwnershipToken } from "@/lib/ownership";

const bodySchema = z.object({ url: z.string().min(4).max(300) });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a URL." }, { status: 400 });
  let origin: string;
  try {
    const url = new URL(parsed.data.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Use an http or https URL.");
    if (url.username || url.password) throw new Error("Remove credentials from the URL.");
    origin = url.origin;
    await assertProbeAllowed(origin, origin);
  } catch (error) {
    const message = error instanceof ProbeBlockedError || error instanceof Error ? error.message : "That URL cannot be scanned.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const existing = await prisma.project.findUnique({ where: { userId_url: { userId: user.id, url: origin } } });
  const project =
    existing ??
    (await prisma.project.create({
      data: { userId: user.id, url: origin, host: new URL(origin).host, ownershipToken: newOwnershipToken() },
    }));
  const instructions = instructionsFor(origin, project.ownershipToken);
  return NextResponse.json({
    projectId: project.id,
    origin,
    token: instructions.token,
    wellKnownUrl: instructions.wellKnownUrl,
    dnsHost: instructions.dnsHost,
    verified: Boolean(project.ownershipVerifiedAt),
    demo: isLocalDemoUrl(origin) && process.env.ALLOW_LOCAL_TARGETS === "true",
  });
}
