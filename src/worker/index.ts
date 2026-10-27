import { writeFileSync } from "node:fs";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "@/lib/db";
import { SCAN_QUEUE_NAME } from "@/lib/queue";
import { purgeFinishedCredentials } from "@/lib/credential-store";
import { workerConcurrency } from "./concurrency";
import { executeScan } from "./execute";
import { scheduleMonitors } from "./schedule";

function markWorkerAlive(): void {
  try {
    writeFileSync("/tmp/vibecheck-worker-alive", String(Date.now()));
  } catch {
    // The health file is optional. Scans still run when it cannot be written.
  }
}

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

const concurrency = workerConcurrency();

const worker = new Worker(
  SCAN_QUEUE_NAME,
  async (job) => {
    const scanId = String(job.data.scanId || "");
    if (!scanId) return;
    await executeScan(scanId);
  },
  { connection, concurrency },
);

worker.on("failed", (job, error) => {
  console.error("scan job failed", job?.id, error);
  const scanId = job?.data?.scanId;
  if (!scanId) return;
  void prisma.scan
    .update({
      where: { id: String(scanId) },
      data: { status: "failed", error: "The scan could not finish. Confirm the site is reachable and try again.", finishedAt: new Date() },
    })
    .catch(() => undefined);
});

const timer = setInterval(() => {
  markWorkerAlive();
  void scheduleMonitors().catch((error) => console.error("monitor schedule failed", error instanceof Error ? error.message : "error"));
  void purgeFinishedCredentials().catch((error) => console.error("credential cleanup failed", error instanceof Error ? error.message : "error"));
}, 10 * 60 * 1000);
timer.unref?.();

void scheduleMonitors().catch((error) => console.error("monitor schedule failed", error instanceof Error ? error.message : "error"));
void purgeFinishedCredentials().catch((error) => console.error("credential cleanup failed", error instanceof Error ? error.message : "error"));

markWorkerAlive();
console.log(`VibeCheck worker ready (concurrency ${concurrency})`);

async function shutdown() {
  clearInterval(timer);
  await worker.close();
  await connection.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
