import { Queue } from "bullmq";
import IORedis from "ioredis";

export const SCAN_QUEUE_NAME = "vibecheck-scans";

function redisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set");
  return url;
}

const globalForQueue = globalThis as unknown as { scanQueue?: Queue; redis?: IORedis };

export function getRedis(): IORedis {
  if (!globalForQueue.redis) {
    globalForQueue.redis = new IORedis(redisUrl(), {
      maxRetriesPerRequest: 2,
      connectTimeout: 2000,
      enableOfflineQueue: false,
    });
  }
  return globalForQueue.redis;
}

export function getScanQueue(): Queue {
  if (!globalForQueue.scanQueue) {
    globalForQueue.scanQueue = new Queue(SCAN_QUEUE_NAME, { connection: getRedis() });
  }
  return globalForQueue.scanQueue;
}

export async function enqueueScan(scanId: string): Promise<void> {
  await getScanQueue().add("scan", { scanId }, { removeOnComplete: 200, removeOnFail: 100, attempts: 1 });
}

/** One queue job per paid scan id. A second webhook or a retry reuses the same job id. */
export async function enqueuePaidScan(scanId: string): Promise<void> {
  const queue = getScanQueue();
  const jobId = `paid-${scanId}`;
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "completed" || state === "failed") await existing.remove();
    else return;
  }
  await queue.add("scan", { scanId }, { jobId, removeOnComplete: true, removeOnFail: true, attempts: 1 });
}
