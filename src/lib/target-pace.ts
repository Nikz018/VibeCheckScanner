/**
 * Per-host pacing for scan traffic. Callers wait for a slot. Checks are not skipped,
 * so the same requests still run. The cap is per process: one worker shares a lane
 * for each host, and a second host is not blocked by the first.
 */

interface Lane {
  active: number;
  lastStart: number;
  queue: Array<() => void>;
}

const lanes = new Map<string, Lane>();

export function targetHostKey(rawUrl: string): string {
  try {
    return new URL(rawUrl).host.toLowerCase();
  } catch {
    return rawUrl.toLowerCase();
  }
}

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

export function targetPaceSettings(
  env: Record<string, string | undefined> = process.env,
): { concurrency: number; minIntervalMs: number } {
  return {
    concurrency: boundedInt(env.SCAN_TARGET_CONCURRENCY, 2, 1, 8),
    minIntervalMs: boundedInt(env.SCAN_TARGET_MIN_INTERVAL_MS, 250, 0, 5000),
  };
}

export function resetTargetPaceForTests(): void {
  lanes.clear();
}

function laneFor(key: string): Lane {
  const existing = lanes.get(key);
  if (existing) return existing;
  const created: Lane = { active: 0, lastStart: 0, queue: [] };
  lanes.set(key, created);
  return created;
}

function acquire(key: string): Promise<void> {
  const { concurrency, minIntervalMs } = targetPaceSettings();
  const lane = laneFor(key);
  return new Promise((resolve) => {
    const grant = () => {
      lane.active += 1;
      const now = Date.now();
      const wait = Math.max(0, lane.lastStart + minIntervalMs - now);
      lane.lastStart = now + wait;
      if (wait === 0) resolve();
      else setTimeout(resolve, wait);
    };
    if (lane.active < concurrency) grant();
    else lane.queue.push(grant);
  });
}

function release(key: string): void {
  const lane = lanes.get(key);
  if (!lane) return;
  lane.active = Math.max(0, lane.active - 1);
  const next = lane.queue.shift();
  if (next) next();
}

export async function withTargetPace<T>(rawUrl: string, fn: () => Promise<T>): Promise<T> {
  const key = targetHostKey(rawUrl);
  await acquire(key);
  try {
    return await fn();
  } finally {
    release(key);
  }
}
