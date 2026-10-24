import { Worker } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "@/lib/db";
import { SCAN_QUEUE_NAME } from "@/lib/queue";
import { executeScan } from "./execute";
import { scheduleMonitors } from "./schedule";

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

const worker = new Worker(
  SCAN_QUEUE_NAME,
  async (job) => {
    const scanId = String(job.data.scanId || "");
    if (!scanId) return;
    await executeScan(scanId);
  },
  { connection, concurrency: 1 },
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
  void scheduleMonitors().catch((error) => console.error("monitor schedule failed", error));
}, 10 * 60 * 1000);
timer.unref?.();

void scheduleMonitors().catch((error) => console.error("monitor schedule failed", error));

console.log("VibeCheck worker ready");

async function shutdown() {
  clearInterval(timer);
  await worker.close();
  await connection.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
