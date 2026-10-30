import assert from "node:assert/strict";
import test from "node:test";
import {
  OSV_BATCH_URL,
  OSV_CACHE_TTL_SECONDS,
  cvssV3BaseScore,
  fallbackAdvisories,
  lookupAdvisories,
  mapOsvVuln,
  osvPackageCacheKey,
  type AdvisoryCache,
  type AdvisoryFetch,
  type OsvVuln,
} from "./osv";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function memoryCache(): AdvisoryCache & { store: Map<string, string>; ttls: number[] } {
  const store = new Map<string, string>();
  const ttls: number[] = [];
  return {
    store,
    ttls,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string, ttlSeconds: number) {
      store.set(key, value);
      ttls.push(ttlSeconds);
    },
  };
}

const LODASH_VECTOR = "CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H";
const CRITICAL_VECTOR = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H";

function lodashVuln(): OsvVuln {
  return {
    id: "GHSA-35jh-r3h4-6jhm",
    summary: "Command Injection in lodash via OSV",
    aliases: ["CVE-2021-23337"],
    severity: [{ type: "CVSS_V3", score: CRITICAL_VECTOR }],
    database_specific: { severity: "HIGH" },
    affected: [
      {
        package: { name: "lodash", ecosystem: "npm" },
        ranges: [{ events: [{ introduced: "0" }, { fixed: "4.17.21" }] }],
      },
      {
        package: { name: "lodash-es", ecosystem: "npm" },
        ranges: [{ events: [{ fixed: "9.9.9" }] }],
      },
      {
        package: { name: "lodash", ecosystem: "RubyGems" },
        ranges: [{ events: [{ fixed: "1.0.0" }] }],
      },
    ],
  };
}

test("CVSS and GHSA labels map onto the report severities", () => {
  assert.equal(cvssV3BaseScore(CRITICAL_VECTOR), 9.8);
  assert.equal(cvssV3BaseScore(LODASH_VECTOR), 7.2);
  assert.equal(cvssV3BaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H"), 10);

  const critical = mapOsvVuln(lodashVuln(), "lodash");
  assert.ok(critical);
  assert.equal(critical.id, "CVE-2021-23337");
  assert.equal(critical.severity, "critical");
  assert.equal(critical.fixed, "4.17.21");
  assert.match(critical.summary, /Command Injection/);
  assert.doesNotMatch(critical.summary, /\bOSV\b|osv\.dev/i);

  const moderate = mapOsvVuln({ id: "GHSA-2222-3333-4444", summary: "Moderate issue", database_specific: { severity: "MODERATE" } }, "leftpad");
  assert.equal(moderate?.id, "GHSA-2222-3333-4444");
  assert.equal(moderate?.severity, "medium");
  assert.equal(moderate?.fixed, null);

  const low = mapOsvVuln({ id: "GHSA-1111-2222-3333", summary: "Minor issue", database_specific: { severity: "LOW" } }, "leftpad");
  assert.equal(low?.severity, "low");

  const numeric = mapOsvVuln({ id: "CVE-2024-0001", summary: "Numeric score", severity: [{ type: "CVSS_V3", score: "4.3" }] }, "leftpad");
  assert.equal(numeric?.severity, "medium");
  assert.equal(numeric?.id, "CVE-2024-0001");

  assert.equal(mapOsvVuln({ id: "GHSA-9999-9999-9999", summary: "Withdrawn", withdrawn: "2024-01-01T00:00:00Z" }, "lodash"), null);
});

test("querybatch ids are hydrated, cached for a day, and not fetched again", async () => {
  const cache = memoryCache();
  const calls: string[] = [];
  const fetchImpl: AdvisoryFetch = async (url, init) => {
    calls.push(url);
    if (url === OSV_BATCH_URL) {
      const body = JSON.parse(init?.body ?? "{}") as { queries: Array<{ version: string; package: { name: string; ecosystem: string } }> };
      assert.equal(body.queries[0]?.package.ecosystem, "npm");
      assert.equal(body.queries[0]?.package.name, "lodash");
      assert.equal(body.queries[0]?.version, "4.17.20");
      assert.equal(body.queries[1]?.package.name, "lodash-es");
      return jsonResponse({
        results: [
          { vulns: [{ id: "GHSA-35jh-r3h4-6jhm", modified: "2024-01-01" }] },
          { vulns: [{ id: "GHSA-35jh-r3h4-6jhm", modified: "2024-01-01" }] },
        ],
      });
    }
    assert.match(url, /\/vulns\/GHSA-35jh-r3h4-6jhm$/);
    return jsonResponse(lodashVuln());
  };

  const first = await lookupAdvisories(
    [
      { name: "lodash", version: "4.17.20" },
      { name: "lodash-es", version: "4.17.20" },
    ],
    { fetch: fetchImpl, cache },
  );
  assert.equal(first.source, "osv");
  assert.equal(first.byPackage.get("lodash@4.17.20")?.[0]?.id, "CVE-2021-23337");
  assert.equal(first.byPackage.get("lodash@4.17.20")?.[0]?.severity, "critical");
  assert.equal(first.byPackage.get("lodash@4.17.20")?.[0]?.fixed, "4.17.21");
  assert.equal(first.byPackage.get("lodash-es@4.17.20")?.[0]?.fixed, "9.9.9");
  assert.equal(calls.length, 2);
  assert.ok(cache.ttls.every((ttl) => ttl === OSV_CACHE_TTL_SECONDS));
  assert.equal(OSV_CACHE_TTL_SECONDS, 24 * 60 * 60);
  assert.equal(osvPackageCacheKey("lodash", "4.17.20").includes("lodash@4.17.20"), true);

  const second = await lookupAdvisories([{ name: "lodash", version: "4.17.20" }], { fetch: fetchImpl, cache });
  assert.equal(second.source, "cache");
  assert.equal(second.byPackage.get("lodash@4.17.20")?.[0]?.id, "CVE-2021-23337");
  assert.equal(calls.length, 2);
});

test("an empty live result is cached and does not use the built-in list", async () => {
  const cache = memoryCache();
  let calls = 0;
  const fetchImpl: AdvisoryFetch = async () => {
    calls += 1;
    return jsonResponse({ results: [{ vulns: [] }] });
  };
  const lookedUp = await lookupAdvisories([{ name: "lodash", version: "4.17.20" }], { fetch: fetchImpl, cache });
  assert.equal(lookedUp.source, "osv");
  assert.deepEqual(lookedUp.byPackage.get("lodash@4.17.20"), []);
  await lookupAdvisories([{ name: "lodash", version: "4.17.20" }], { fetch: fetchImpl, cache });
  assert.equal(calls, 1);
  assert.equal(fallbackAdvisories("lodash", "4.17.20")[0]?.id, "CVE-2021-23337");
});

test("unreachable advisory data falls back to the built-in list without caching it", async () => {
  const cache = memoryCache();
  const offline: AdvisoryFetch = async () => {
    throw new Error("offline");
  };
  const lookedUp = await lookupAdvisories(
    [
      { name: "lodash", version: "4.17.20" },
      { name: "axios", version: "0.27.2" },
      { name: "axios", version: "1.6.0" },
      { name: "leftpad", version: "1.0.0" },
    ],
    { fetch: offline, cache },
  );
  assert.equal(lookedUp.source, "fallback");
  assert.equal(lookedUp.byPackage.get("lodash@4.17.20")?.[0]?.id, "CVE-2021-23337");
  assert.equal(lookedUp.byPackage.get("lodash@4.17.20")?.[0]?.fixed, "4.17.21");
  assert.equal(lookedUp.byPackage.get("lodash@4.17.20")?.[0]?.severity, "high");
  assert.equal(lookedUp.byPackage.get("axios@0.27.2")?.[0]?.id, "CVE-2023-45857");
  assert.deepEqual(lookedUp.byPackage.get("axios@1.6.0"), []);
  assert.deepEqual(lookedUp.byPackage.get("leftpad@1.0.0"), []);
  assert.equal(cache.store.size, 0);
});

test("a batch id whose record cannot be loaded uses the built-in list for that package", async () => {
  const cache = memoryCache();
  const fetchImpl: AdvisoryFetch = async (url) => {
    if (url === OSV_BATCH_URL) return jsonResponse({ results: [{ vulns: [{ id: "GHSA-35jh-r3h4-6jhm" }] }] });
    return jsonResponse({ error: "nope" }, 500);
  };
  const lookedUp = await lookupAdvisories([{ name: "lodash", version: "4.17.20" }], { fetch: fetchImpl, cache });
  assert.equal(lookedUp.source, "fallback");
  assert.equal(lookedUp.byPackage.get("lodash@4.17.20")?.[0]?.id, "CVE-2021-23337");
  assert.equal([...cache.store.keys()].some((key) => key.includes("npm:lodash@")), false);
});

test("lookup does not require Redis", async () => {
  const previous = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  try {
    const lookedUp = await lookupAdvisories([{ name: "leftpad", version: "1.0.0" }], {
      fetch: async () => jsonResponse({ results: [{ vulns: [] }] }),
    });
    assert.equal(lookedUp.source, "osv");
    assert.deepEqual(lookedUp.byPackage.get("leftpad@1.0.0"), []);
  } finally {
    if (previous === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previous;
  }
});
