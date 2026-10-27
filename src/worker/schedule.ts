import { prisma } from "@/lib/db";
import { enqueueScan } from "@/lib/queue";
import { recordScanAuthorization } from "@/lib/scan-authorization";

export async function scheduleMonitors(): Promise<void> {
  const hours = Number(process.env.MONITOR_INTERVAL_HOURS || 24);
  const cutoff = new Date(Date.now() - (Number.isFinite(hours) && hours > 0 ? hours : 24) * 60 * 60 * 1000);
  const projects = await prisma.project.findMany({
    where: {
      monitorEnabled: true,
      ownershipVerifiedAt: { not: null },
      user: { subscription: { status: { in: ["active", "trialing"] } } },
    },
    include: {
      user: { select: { email: true } },
      scans: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  for (const project of projects) {
    const latest = project.scans[0];
    if (latest && (latest.status === "queued" || latest.status === "running")) continue;
    if (latest && latest.createdAt > cutoff) continue;
    const scan = await prisma.scan.create({
      data: {
        projectId: project.id,
        userId: project.userId,
        status: "queued",
        mode: "full",
        reportAccess: "full",
        targetUrl: project.url,
        consentAt: new Date(),
        consentText: "Scheduled rescan authorized when monitoring was enabled for this verified origin.",
        scheduled: true,
      },
    });
    await recordScanAuthorization({
      userId: project.userId,
      userEmail: project.user.email,
      projectId: project.id,
      scanId: scan.id,
      targetUrl: project.url,
      kind: "consent",
      method: "monitor_schedule",
      note: "Scheduled rescan authorized when monitoring was enabled for this verified origin.",
    });
    await enqueueScan(scan.id);
  }
}
