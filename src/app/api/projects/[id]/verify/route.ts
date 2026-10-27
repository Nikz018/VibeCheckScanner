import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthInputError, parseAuthScan } from "@/lib/auth-input";
import { getCurrentUser } from "@/lib/auth";
import { CredentialsKeyError, credentialsKey } from "@/lib/credentials";
import { deleteScanCredentials, saveScanCredentials } from "@/lib/credential-store";
import { prisma } from "@/lib/db";
import { resolveReportAccess } from "@/lib/entitlements";
import { LOGIN_AVAILABLE_NOTICE } from "@/lib/limitations";
import { enqueueScan } from "@/lib/queue";
import { CONSENT_TEXT, assertConsent, verifyOwnership } from "@/lib/ownership";
import { recordScanAuthorization } from "@/lib/scan-authorization";

const bodySchema = z.object({
  consent: z.boolean(),
  mode: z.enum(["full", "mini"]).default("full"),
  use: z.enum(["teaser", "credit", "rescan"]).default("teaser"),
  auth: z.unknown().optional(),
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
  if (!proof.ok || !proof.method) return NextResponse.json({ error: proof.reason || "Ownership proof was not found." }, { status: 400 });
  await prisma.project.update({
    where: { id: project.id },
    data: { ownershipVerifiedAt: new Date(), ownershipMethod: proof.method },
  });
  await recordScanAuthorization({
    userId: user.id,
    userEmail: user.email,
    projectId: project.id,
    targetUrl: project.url,
    kind: "ownership",
    method: proof.method,
  });

  const active = await prisma.scan.count({ where: { userId: user.id, status: { in: ["queued", "running"] } } });
  if (active >= 3) return NextResponse.json({ error: "Wait for a running scan to finish before starting another." }, { status: 429 });

  const mode = parsed.data.mode;
  if (parsed.data.auth && mode === "mini") {
    return NextResponse.json({ error: "Logged-in checks run on a full launch scan." }, { status: 400 });
  }
  let auth = null;
  if (parsed.data.auth) {
    try {
      auth = parseAuthScan(parsed.data.auth, project.url);
      credentialsKey();
    } catch (error) {
      if (error instanceof CredentialsKeyError) {
        return NextResponse.json({ error: "Credential storage is not configured." }, { status: 503 });
      }
      const message = error instanceof AuthInputError ? error.message : "Check the test-account fields and try again.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }
  const reportAccess = mode === "mini" ? "full" : await resolveReportAccess(user.id, parsed.data.use);
  if (auth && reportAccess !== "full") {
    return NextResponse.json({ error: LOGIN_AVAILABLE_NOTICE }, { status: 400 });
  }
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
  await recordScanAuthorization({
    userId: user.id,
    userEmail: user.email,
    projectId: project.id,
    scanId: scan.id,
    targetUrl: project.url,
    kind: "consent",
    method: "checkbox",
    note: CONSENT_TEXT,
  });
  if (auth) {
    try {
      await saveScanCredentials(scan.id, auth);
    } catch (error) {
      await prisma.scan.update({
        where: { id: scan.id },
        data: { status: "failed", error: "Credential storage is not configured.", finishedAt: new Date() },
      });
      const message = error instanceof CredentialsKeyError ? "Credential storage is not configured." : "Test-account credentials could not be stored.";
      return NextResponse.json({ error: message }, { status: 503 });
    }
  }
  try {
    await enqueueScan(scan.id);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "queue unavailable");
    await deleteScanCredentials(scan.id).catch(() => undefined);
    await prisma.scan.update({
      where: { id: scan.id },
      data: { status: "failed", error: "The scan queue is unavailable." },
    });
    return NextResponse.json({ error: "The scan queue is unavailable. Check Redis and try again." }, { status: 503 });
  }
  return NextResponse.json({ scanId: scan.id });
}
