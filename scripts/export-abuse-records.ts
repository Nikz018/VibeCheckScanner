/**
 * Export ownership and consent records for one host.
 * Usage: npx tsx scripts/export-abuse-records.ts --host example.com
 * Prints JSON to stdout. Does not print ownership tokens or test-account secrets.
 */
import { prisma } from "../src/lib/db";
import { hostsMatch, parseAbuseHost, shapeAbuseExport, type AbuseAuthorizationRow, type AbuseProjectRow, type AbuseScanRow } from "../src/lib/scan-authorization";

function redact(message: string): string {
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://[redacted]");
}

function hostArg(): string {
  const index = process.argv.indexOf("--host");
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (!value || value.startsWith("--")) {
    console.error("Usage: npx tsx scripts/export-abuse-records.ts --host example.com");
    process.exit(1);
  }
  return parseAbuseHost(value);
}

async function main(): Promise<void> {
  const host = hostArg();
  const [authorizations, scans, projects] = await Promise.all([
    prisma.scanAuthorization.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.scan.findMany({ include: { user: { select: { email: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.project.findMany({ include: { user: { select: { email: true } } }, orderBy: { createdAt: "asc" } }),
  ]);

  const exportRows = shapeAbuseExport({
    host,
    exportedAt: new Date().toISOString(),
    authorizations: authorizations
      .filter((row) => hostsMatch(row.host, host))
      .map(
        (row): AbuseAuthorizationRow => ({
          id: row.id,
          userId: row.userId,
          userEmail: row.userEmail,
          projectId: row.projectId,
          scanId: row.scanId,
          targetUrl: row.targetUrl,
          host: row.host,
          kind: row.kind,
          method: row.method,
          note: row.note,
          createdAt: row.createdAt.toISOString(),
        }),
      ),
    scans: scans
      .filter((row) => {
        try {
          return hostsMatch(new URL(row.targetUrl).host, host);
        } catch {
          return false;
        }
      })
      .map(
        (row): AbuseScanRow => ({
          id: row.id,
          userId: row.userId,
          userEmail: row.user.email,
          projectId: row.projectId,
          targetUrl: row.targetUrl,
          status: row.status,
          consentAt: row.consentAt?.toISOString() ?? null,
          consentText: row.consentText,
          createdAt: row.createdAt.toISOString(),
          startedAt: row.startedAt?.toISOString() ?? null,
          finishedAt: row.finishedAt?.toISOString() ?? null,
        }),
      ),
    projects: projects
      .filter((row) => hostsMatch(row.host, host))
      .map(
        (row): AbuseProjectRow => ({
          id: row.id,
          userId: row.userId,
          userEmail: row.user.email,
          targetUrl: row.url,
          host: row.host,
          ownershipMethod: row.ownershipMethod,
          ownershipVerifiedAt: row.ownershipVerifiedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        }),
      ),
  });

  process.stdout.write(`${JSON.stringify(exportRows, null, 2)}\n`);
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "export failed";
    console.error(redact(message));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
