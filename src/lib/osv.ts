import { matchAdvisories, compareVersions } from "./advisories";
import { getRedis } from "./queue";
import type { Severity } from "./catalog";
import { scannerUserAgent } from "./scanner-identity";

export const OSV_CACHE_TTL_SECONDS = 24 * 60 * 60;
export const OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch";
const OSV_VULN_PREFIX = "https://api.osv.dev/v1/vulns/";
const MAX_QUERIES = 40;
const MAX_HYDRATIONS = 80;
const HYDRATE_CONCURRENCY = 6;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export interface PackageVersion {
  name: string;
  version: string;
}

export interface AdvisoryHit {
  id: string;
  summary: string;
  severity: Severity;
  fixed: string | null;
}

export interface AdvisoryCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export interface AdvisoryRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export type AdvisoryFetch = (url: string, init?: AdvisoryRequest) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export interface LookupOptions {
  fetch?: AdvisoryFetch;
  /** Pass null to skip Redis. Omit to use Redis when REDIS_URL is set. */
  cache?: AdvisoryCache | null;
}

export interface AdvisoryLookup {
  byPackage: Map<string, AdvisoryHit[]>;
  source: "cache" | "osv" | "fallback" | "mixed";
}

export type AdvisoryLookupFn = (packages: PackageVersion[], options?: LookupOptions) => Promise<AdvisoryLookup>;

interface OsvEvent {
  fixed?: string;
  introduced?: string;
}

interface OsvRange {
  events?: OsvEvent[];
}

interface OsvAffected {
  package?: { name?: string; ecosystem?: string };
  ecosystem?: string;
  ranges?: OsvRange[];
}

export interface OsvVuln {
  id?: string;
  summary?: string;
  aliases?: string[];
  withdrawn?: string | null;
  severity?: Array<{ type?: string; score?: string }>;
  affected?: OsvAffected[];
  database_specific?: { severity?: string };
  ecosystem_specific?: { severity?: string };
}

interface BatchSlot {
  vulns?: OsvVuln[];
  error?: unknown;
}

type Origin = "cache" | "osv" | "fallback";

export function packageAdvisoryKey(name: string, version: string): string {
  return `${name}@${version}`;
}

export function osvPackageCacheKey(name: string, version: string): string {
  return `vibecheck:osv:v1:npm:${name}@${version}`;
}

function vulnCacheKey(id: string): string {
  return `vibecheck:osv:v1:vuln:${id}`;
}

export function severityFromCvss(score: number): Severity {
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

export function cvssV3BaseScore(vector: string): number | null {
  const match = vector.trim().match(/^CVSS:3\.[01]\/(.+)$/i);
  if (!match) return null;
  const parts = Object.fromEntries(match[1].split("/").map((part) => part.split(":")));
  const attackVector: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
  const attackComplexity: Record<string, number> = { L: 0.77, H: 0.44 };
  const userInteraction: Record<string, number> = { N: 0.85, R: 0.62 };
  const privileges = parts.S === "C" ? { N: 0.85, L: 0.68, H: 0.5 } : { N: 0.85, L: 0.62, H: 0.27 };
  const impact: Record<string, number> = { N: 0, L: 0.22, H: 0.56 };
  const av = attackVector[parts.AV];
  const ac = attackComplexity[parts.AC];
  const ui = userInteraction[parts.UI];
  const pr = privileges[parts.PR as "N" | "L" | "H"];
  const confidentiality = impact[parts.C];
  const integrity = impact[parts.I];
  const availability = impact[parts.A];
  if ([av, ac, ui, pr, confidentiality, integrity, availability].some((value) => value === undefined)) return null;
  const impactSub = 1 - (1 - confidentiality) * (1 - integrity) * (1 - availability);
  const scopeChanged = parts.S === "C";
  const impactScore = scopeChanged
    ? 7.52 * (impactSub - 0.029) - 3.25 * (impactSub - 0.02) ** 15
    : 6.42 * impactSub;
  const exploitability = 8.22 * av * ac * pr * ui;
  let base = impactScore + exploitability;
  base = scopeChanged ? Math.min(1.08 * base, 10) : Math.min(base, 10);
  if (base <= 0) return 0;
  return roundup(base);
}

function roundup(input: number): number {
  const intInput = Math.round(input * 100000);
  if (intInput % 10000 === 0) return intInput / 100000;
  return (Math.floor(intInput / 10000) + 1) / 10;
}

function severityFromLabel(value: unknown): Severity | null {
  if (typeof value !== "string") return null;
  const label = value.trim().toUpperCase();
  if (label === "CRITICAL") return "critical";
  if (label === "HIGH") return "high";
  if (label === "MODERATE" || label === "MEDIUM") return "medium";
  if (label === "LOW") return "low";
  return null;
}

function numericScore(score: unknown): number | null {
  if (typeof score === "number" && Number.isFinite(score)) return score;
  if (typeof score !== "string") return null;
  const trimmed = score.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return cvssV3BaseScore(trimmed);
}

export function mapOsvSeverity(vuln: OsvVuln): Severity {
  let best: number | null = null;
  for (const entry of vuln.severity ?? []) {
    const score = numericScore(entry?.score);
    if (score === null) continue;
    if (best === null || score > best) best = score;
  }
  if (best !== null) return severityFromCvss(best);
  return severityFromLabel(vuln.database_specific?.severity) ?? severityFromLabel(vuln.ecosystem_specific?.severity) ?? "medium";
}

export function publicSummary(summary: string): string {
  const cleaned = summary
    .replace(/\bosv\.dev\b/gi, "public vulnerability database")
    .replace(/\bOSV\b/g, "public vulnerability database")
    .replace(/\s+/g, " ")
    .trim();
  const text = cleaned || "Published vulnerability";
  return text.length > 180 ? `${text.slice(0, 179)}…` : text;
}

export function advisoryId(vuln: { id?: string; aliases?: string[] }): string | null {
  const aliases = Array.isArray(vuln.aliases) ? vuln.aliases.filter((alias) => typeof alias === "string") : [];
  const cve = aliases.find((alias) => /^CVE-\d{4}-\d{4,}$/i.test(alias));
  if (cve) return cve.toUpperCase();
  if (vuln.id && /^CVE-\d{4}-\d{4,}$/i.test(vuln.id)) return vuln.id.toUpperCase();
  if (vuln.id && /^GHSA-/i.test(vuln.id)) return vuln.id;
  const ghsa = aliases.find((alias) => /^GHSA-/i.test(alias));
  if (ghsa) return ghsa;
  return vuln.id || null;
}

function fixedFor(vuln: OsvVuln, packageName: string): string | null {
  const fixes: string[] = [];
  for (const item of vuln.affected ?? []) {
    const ecosystem = (item.package?.ecosystem ?? item.ecosystem ?? "").toLowerCase();
    if (ecosystem && ecosystem !== "npm") continue;
    const name = item.package?.name?.toLowerCase();
    if (name && name !== packageName.toLowerCase()) continue;
    for (const range of item.ranges ?? []) {
      for (const event of range.events ?? []) {
        if (typeof event.fixed === "string" && event.fixed.trim()) fixes.push(event.fixed.trim());
      }
    }
  }
  const unique = [...new Set(fixes)];
  unique.sort(compareVersions);
  return unique[0] ?? null;
}

export function mapOsvVuln(vuln: OsvVuln, packageName: string): AdvisoryHit | null {
  if (!vuln || typeof vuln !== "object") return null;
  if (typeof vuln.withdrawn === "string" && vuln.withdrawn.trim()) return null;
  const id = advisoryId(vuln);
  if (!id) return null;
  return {
    id,
    summary: publicSummary(typeof vuln.summary === "string" ? vuln.summary : ""),
    severity: mapOsvSeverity(vuln),
    fixed: fixedFor(vuln, packageName),
  };
}

export function fallbackAdvisories(name: string, version: string): AdvisoryHit[] {
  return matchAdvisories({ [name]: version }).map((hit) => ({
    id: hit.cve.toUpperCase(),
    summary: publicSummary(hit.summary),
    severity: "high" as const,
    fixed: hit.below,
  }));
}

function parseHits(raw: string): AdvisoryHit[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const hits: AdvisoryHit[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") return null;
      const row = item as Partial<AdvisoryHit>;
      if (typeof row.id !== "string" || typeof row.summary !== "string") return null;
      if (row.severity !== "critical" && row.severity !== "high" && row.severity !== "medium" && row.severity !== "low") return null;
      hits.push({
        id: row.id,
        summary: row.summary,
        severity: row.severity,
        fixed: typeof row.fixed === "string" ? row.fixed : null,
      });
    }
    return hits;
  } catch {
    return null;
  }
}

function dedupeHits(hits: AdvisoryHit[]): AdvisoryHit[] {
  const rank: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
  const byId = new Map<string, AdvisoryHit>();
  for (const hit of hits) {
    if (!hit) continue;
    const key = hit.id.toUpperCase();
    const existing = byId.get(key);
    if (!existing) {
      byId.set(key, hit);
      continue;
    }
    byId.set(key, {
      id: existing.id,
      summary: existing.summary || hit.summary,
      severity: rank[hit.severity] > rank[existing.severity] ? hit.severity : existing.severity,
      fixed: existing.fixed ?? hit.fixed,
    });
  }
  return [...byId.values()];
}

function isFullVuln(vuln: OsvVuln): boolean {
  return Boolean(vuln.summary || (vuln.severity && vuln.severity.length > 0) || (vuln.affected && vuln.affected.length > 0) || vuln.database_specific);
}

function stubHit(id: string): AdvisoryHit {
  const cve = /^CVE-\d{4}-\d{4,}$/i.test(id) ? id.toUpperCase() : id;
  return { id: cve, summary: "Published vulnerability", severity: "medium", fixed: null };
}

let redisErrorsHooked = false;

export async function redisAdvisoryCache(): Promise<AdvisoryCache | null> {
  if (!process.env.REDIS_URL) return null;
  try {
    const redis = getRedis();
    if (!redisErrorsHooked) {
      redis.on("error", () => undefined);
      redisErrorsHooked = true;
    }
    return {
      async get(key: string) {
        try {
          return await redis.get(key);
        } catch {
          return null;
        }
      },
      async set(key: string, value: string, ttlSeconds: number) {
        try {
          await redis.set(key, value, "EX", ttlSeconds);
        } catch {
          // The live result is still used for this scan when the cache write fails.
        }
      },
    };
  } catch {
    return null;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function lookupAdvisories(packages: PackageVersion[], options: LookupOptions = {}): Promise<AdvisoryLookup> {
  try {
    return await lookupLive(packages, options);
  } catch (error) {
    console.error("dependency advisory lookup failed", error instanceof Error ? error.message : "error");
    return { byPackage: fallbackMap(packages), source: "fallback" };
  }
}

function fallbackMap(packages: PackageVersion[]): Map<string, AdvisoryHit[]> {
  const byPackage = new Map<string, AdvisoryHit[]>();
  for (const item of uniquePackages(packages)) {
    byPackage.set(packageAdvisoryKey(item.name, item.version), fallbackAdvisories(item.name, item.version));
  }
  return byPackage;
}

function uniquePackages(packages: PackageVersion[]): PackageVersion[] {
  const seen = new Set<string>();
  const unique: PackageVersion[] = [];
  for (const item of packages) {
    const name = item.name.trim().toLowerCase();
    const version = item.version.trim().replace(/^v/i, "");
    if (!VERSION.test(version) || !name) continue;
    const key = packageAdvisoryKey(name, version);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ name, version });
    if (unique.length >= MAX_QUERIES) break;
  }
  return unique;
}

async function lookupLive(packages: PackageVersion[], options: LookupOptions): Promise<AdvisoryLookup> {
  const list = uniquePackages(packages);
  const byPackage = new Map<string, AdvisoryHit[]>();
  if (list.length === 0) return { byPackage, source: "cache" };
  const fetchImpl = options.fetch ?? ((url: string, init?: AdvisoryRequest) => fetch(url, init));
  const cache = options.cache === undefined ? await redisAdvisoryCache() : options.cache;
  const origins = new Map<string, Origin>();
  const misses: PackageVersion[] = [];

  for (const item of list) {
    const key = packageAdvisoryKey(item.name, item.version);
    const cached = cache ? parseHits((await cache.get(osvPackageCacheKey(item.name, item.version))) ?? "") : null;
    if (cached) {
      byPackage.set(key, cached);
      origins.set(key, "cache");
      continue;
    }
    misses.push(item);
  }

  if (misses.length > 0) {
    let slots: BatchSlot[] | null = null;
    try {
      const response = await fetchImpl(OSV_BATCH_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": scannerUserAgent(),
        },
        body: JSON.stringify({
          queries: misses.map((item) => ({
            version: item.version,
            package: { name: item.name, ecosystem: "npm" },
          })),
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error("advisory batch failed");
      const body = (await response.json()) as { results?: BatchSlot[] };
      slots = Array.isArray(body.results) ? body.results : null;
      if (!slots || slots.length < misses.length) throw new Error("advisory batch was incomplete");
    } catch (error) {
      console.error("dependency advisory lookup failed", error instanceof Error ? error.message : "error");
      slots = null;
    }

    const budget = { remaining: MAX_HYDRATIONS };
    const inflight = new Map<string, Promise<OsvVuln | null>>();
    if (!slots) {
      for (const item of misses) {
        const key = packageAdvisoryKey(item.name, item.version);
        byPackage.set(key, fallbackAdvisories(item.name, item.version));
        origins.set(key, "fallback");
      }
    } else {
      const batch = slots;
      const resolved = await mapLimit(misses, HYDRATE_CONCURRENCY, (item, index) =>
        resolvePackage(item, batch[index] ?? {}, fetchImpl, cache, budget, inflight),
      );
      for (const row of resolved) {
        byPackage.set(row.key, row.hits);
        origins.set(row.key, row.origin);
      }
    }
  }

  return { byPackage, source: combineOrigins([...origins.values()]) };
}

async function resolvePackage(
  item: PackageVersion,
  slot: BatchSlot,
  fetchImpl: AdvisoryFetch,
  cache: AdvisoryCache | null,
  budget: { remaining: number },
  inflight: Map<string, Promise<OsvVuln | null>>,
): Promise<{ key: string; hits: AdvisoryHit[]; origin: Origin }> {
  const key = packageAdvisoryKey(item.name, item.version);
  if (slot.error || !Array.isArray(slot.vulns)) {
    return { key, hits: fallbackAdvisories(item.name, item.version), origin: "fallback" };
  }
  if (slot.vulns.length === 0) {
    if (cache) await cache.set(osvPackageCacheKey(item.name, item.version), "[]", OSV_CACHE_TTL_SECONDS);
    return { key, hits: [], origin: "osv" };
  }

  const full: AdvisoryHit[] = [];
  const stubs: AdvisoryHit[] = [];
  let failed = false;
  for (const vuln of slot.vulns) {
    if (!vuln || typeof vuln.id !== "string" || !vuln.id) continue;
    if (isFullVuln(vuln)) {
      const mapped = mapOsvVuln(vuln, item.name);
      if (mapped) full.push(mapped);
      continue;
    }
    if (budget.remaining <= 0) {
      failed = true;
      stubs.push(stubHit(vuln.id));
      continue;
    }
    budget.remaining -= 1;
    const hydrated = await fetchVuln(vuln.id, fetchImpl, cache, inflight);
    if (!hydrated) {
      failed = true;
      stubs.push(stubHit(vuln.id));
      continue;
    }
    const mapped = mapOsvVuln(hydrated, item.name);
    if (mapped) full.push(mapped);
  }

  if (full.length > 0) {
    const hits = dedupeHits(full);
    if (!failed && cache) await cache.set(osvPackageCacheKey(item.name, item.version), JSON.stringify(hits), OSV_CACHE_TTL_SECONDS);
    return { key, hits, origin: "osv" };
  }
  if (failed) {
    const fallback = fallbackAdvisories(item.name, item.version);
    if (fallback.length > 0) return { key, hits: fallback, origin: "fallback" };
    return { key, hits: dedupeHits(stubs), origin: "osv" };
  }
  if (cache) await cache.set(osvPackageCacheKey(item.name, item.version), "[]", OSV_CACHE_TTL_SECONDS);
  return { key, hits: [], origin: "osv" };
}

async function fetchVuln(
  id: string,
  fetchImpl: AdvisoryFetch,
  cache: AdvisoryCache | null,
  inflight: Map<string, Promise<OsvVuln | null>>,
): Promise<OsvVuln | null> {
  const pending = inflight.get(id);
  if (pending) return pending;
  const promise = loadVuln(id, fetchImpl, cache);
  inflight.set(id, promise);
  return promise;
}

async function loadVuln(id: string, fetchImpl: AdvisoryFetch, cache: AdvisoryCache | null): Promise<OsvVuln | null> {
  const key = vulnCacheKey(id);
  if (cache) {
    const cached = await cache.get(key);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as OsvVuln;
        if (parsed && typeof parsed === "object" && typeof parsed.id === "string") return parsed;
      } catch {
        // Read the record again when the cached copy is not JSON.
      }
    }
  }
  try {
    const response = await fetchImpl(`${OSV_VULN_PREFIX}${encodeURIComponent(id)}`, {
      method: "GET",
      headers: { accept: "application/json", "user-agent": scannerUserAgent() },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as OsvVuln;
    if (!body || typeof body !== "object" || typeof body.id !== "string") return null;
    if (cache) await cache.set(key, JSON.stringify(body), OSV_CACHE_TTL_SECONDS);
    return body;
  } catch {
    return null;
  }
}

function combineOrigins(origins: Origin[]): AdvisoryLookup["source"] {
  const kinds = new Set(origins);
  if (kinds.size === 0) return "cache";
  if (kinds.size === 1) return [...kinds][0];
  return "mixed";
}
