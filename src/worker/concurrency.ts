/** BullMQ jobs per worker process. One browser at a time on a small VM. */
export function workerConcurrency(raw = process.env.WORKER_CONCURRENCY): number {
  if (raw == null || raw.trim() === "") return 1;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 8);
}
