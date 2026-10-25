import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

process.env.CREDENTIALS_ENCRYPTION_KEY = process.env.CREDENTIALS_ENCRYPTION_KEY || "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL is not set";

test("stored credentials are encrypted, deleted with the scan, and purged after finish or TTL", { skip }, async () => {
  const { prisma } = await import("./db");
  const { saveScanCredentials, loadScanCredentials, deleteScanCredentials, purgeFinishedCredentials } = await import("./credential-store");
  const suffix = randomBytes(4).toString("hex");
  const user = await prisma.user.create({ data: { email: `creds-${suffix}@example.com` } });
  const project = await prisma.project.create({
    data: { userId: user.id, url: "http://127.0.0.1:4013", host: "127.0.0.1:4013", ownershipToken: `vc_${suffix.padEnd(32, "a").slice(0, 32)}` },
  });
  const running = await prisma.scan.create({
    data: { projectId: project.id, userId: user.id, status: "running", reportAccess: "full", targetUrl: project.url, consentAt: new Date() },
  });
  const payload = {
    consent: true as const,
    accounts: [
      {
        label: "A" as const,
        loginUrl: "http://127.0.0.1:4013/login",
        username: "alice@example.test",
        password: "test-password-alice",
        cookie: "",
        bearerToken: "",
      },
    ],
  };
  await saveScanCredentials(running.id, payload);
  const stored = await prisma.scanCredential.findUniqueOrThrow({ where: { scanId: running.id } });
  assert.equal(stored.ciphertext.includes("test-password-alice"), false);
  assert.deepEqual(await loadScanCredentials(running.id), payload);
  await deleteScanCredentials(running.id);
  assert.equal(await prisma.scanCredential.findUnique({ where: { scanId: running.id } }), null);

  const finished = await prisma.scan.create({
    data: { projectId: project.id, userId: user.id, status: "completed", reportAccess: "full", targetUrl: project.url, consentAt: new Date() },
  });
  await saveScanCredentials(finished.id, payload);
  assert.ok((await purgeFinishedCredentials()) >= 1);
  assert.equal(await prisma.scanCredential.findUnique({ where: { scanId: finished.id } }), null);

  const expired = await prisma.scan.create({
    data: { projectId: project.id, userId: user.id, status: "running", reportAccess: "full", targetUrl: project.url, consentAt: new Date() },
  });
  await prisma.scanCredential.create({
    data: { scanId: expired.id, ciphertext: stored.ciphertext, expiresAt: new Date(Date.now() - 1000) },
  });
  assert.equal(await loadScanCredentials(expired.id), null);
  assert.equal(await prisma.scanCredential.findUnique({ where: { scanId: expired.id } }), null);

  await prisma.user.delete({ where: { id: user.id } });
});
