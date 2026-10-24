import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveReportAccess } from "@/lib/entitlements";
import { enqueueScan } from "@/lib/queue";
import { CONSENT_TEXT, assertConsent, verifyOwnership } from "@/lib/ownership";

const bodySchema = z.object({
  consent: z.boolean(),
  mode: z.enum(["full", "mini"]).default("full"),
  use: z.enum(["teaser", "credit", "rescan"]).default("teaser"),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await context.params;
  const project = await prisma.project.findFirst({ where: { id, userId: user.id } });
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Consent is required." }, { status: 400 });
  try {
    assertConsent(parsed.data.consent);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Consent is required." }, { status: 400 });
  }

  const proof = await verifyOwnership(project.url, project.ownershipToken);
  if (!proof.ok) return NextResponse.json({ error: proof.reason || "Ownership proof was not found." }, { status: 400 });
  await prisma.project.update({
    where: { id: project.id },
    data: { ownershipVerifiedAt: new Date(), ownershipMethod: proof.method },
  });

  const active = await prisma.scan.count({ where: { userId: user.id, status: { in: ["queued", "running"] } } });
  if (active >= 3) return NextResponse.json({ error: "Wait for a running scan to finish before starting another." }, { status: 429 });

  const mode = parsed.data.mode;
  const reportAccess = mode === "mini" ? "full" : await resolveReportAccess(user.id, parsed.data.use);
  const scan = await prisma.scan.create({
    data: {
      projectId: project.id,
      userId: user.id,
      status: "queued",
      mode,
      reportAccess,
      targetUrl: project.url,
      consentAt: new Date(),
      consentText: CONSENT_TEXT,
    },
  });
  try {
    await enqueueScan(scan.id);
  } catch (error) {
    console.error(error);
    await prisma.scan.update({
      where: { id: scan.id },
      data: { status: "failed", error: "The scan queue is unavailable." },
    });
    return NextResponse.json({ error: "The scan queue is unavailable. Check Redis and try again." }, { status: 503 });
  }
  return NextResponse.json({ scanId: scan.id });
}
