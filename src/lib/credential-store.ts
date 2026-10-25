import type { AuthScanPayload } from "./auth-input";
import { credentialExpiresAt, decryptCredentials, encryptCredentials, shouldDeleteCredential } from "./credentials";
import { prisma } from "./db";

export async function saveScanCredentials(scanId: string, payload: AuthScanPayload, now = new Date()): Promise<void> {
  const ciphertext = encryptCredentials(payload);
  await prisma.scanCredential.create({
    data: { scanId, ciphertext, expiresAt: credentialExpiresAt(now) },
  });
}

export async function loadScanCredentials(scanId: string, now = new Date()): Promise<AuthScanPayload | null> {
  const row = await prisma.scanCredential.findUnique({ where: { scanId }, include: { scan: true } });
  if (!row) return null;
  if (shouldDeleteCredential({ expiresAt: row.expiresAt, scanStatus: row.scan.status, now })) {
    await prisma.scanCredential.delete({ where: { id: row.id } });
    return null;
  }
  return decryptCredentials<AuthScanPayload>(row.ciphertext);
}

export async function deleteScanCredentials(scanId: string): Promise<void> {
  await prisma.scanCredential.deleteMany({ where: { scanId } });
}

/** Drop rows whose TTL has passed and rows whose scan already finished. */
export async function purgeFinishedCredentials(now = new Date()): Promise<number> {
  const result = await prisma.scanCredential.deleteMany({
    where: {
      OR: [{ expiresAt: { lte: now } }, { scan: { status: { in: ["completed", "failed"] } } }],
    },
  });
  return result.count;
}
