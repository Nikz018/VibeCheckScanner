import assert from "node:assert/strict";
import test from "node:test";
import { abuseContactEmail, scannerUserAgent } from "./scanner-identity";
import { parseAbuseHost, shapeAbuseExport } from "./scan-authorization";
import { resetTargetPaceForTests, targetHostKey, targetPaceSettings, withTargetPace } from "./target-pace";

test("scanner user agent names VibeCheck and links to scanner-info", () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://scan.example.com";
  try {
    assert.equal(scannerUserAgent(), "VibeCheckScanner/0.1 (+https://scan.example.com/scanner-info)");
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
  }
});

test("abuse contact email is shown only when it is an email", () => {
  assert.equal(abuseContactEmail(""), "");
  assert.equal(abuseContactEmail("not an email"), "");
  assert.equal(abuseContactEmail("  abuse@example.com  "), "abuse@example.com");
});

test("target pace uses gentle defaults and ignores out-of-range values", () => {
  assert.deepEqual(targetPaceSettings({} as NodeJS.ProcessEnv), { concurrency: 2, minIntervalMs: 250 });
  assert.deepEqual(targetPaceSettings({ SCAN_TARGET_CONCURRENCY: "1", SCAN_TARGET_MIN_INTERVAL_MS: "0" }), {
    concurrency: 1,
    minIntervalMs: 0,
  });
  assert.deepEqual(targetPaceSettings({ SCAN_TARGET_CONCURRENCY: "0", SCAN_TARGET_MIN_INTERVAL_MS: "nope" }), {
    concurrency: 2,
    minIntervalMs: 250,
  });
  assert.deepEqual(targetPaceSettings({ SCAN_TARGET_CONCURRENCY: "9", SCAN_TARGET_MIN_INTERVAL_MS: "9000" }), {
    concurrency: 2,
    minIntervalMs: 250,
  });
  assert.equal(targetHostKey("https://Example.com:8443/a"), "example.com:8443");
});

test("target pace waits for a slot and still runs every check", async () => {
  resetTargetPaceForTests();
  const previousConcurrency = process.env.SCAN_TARGET_CONCURRENCY;
  const previousInterval = process.env.SCAN_TARGET_MIN_INTERVAL_MS;
  process.env.SCAN_TARGET_CONCURRENCY = "1";
  process.env.SCAN_TARGET_MIN_INTERVAL_MS = "40";
  const order: string[] = [];
  try {
    await Promise.all([
      withTargetPace("https://example.com/a", async () => {
        order.push("first-start");
        await new Promise((resolve) => setTimeout(resolve, 30));
        order.push("first-end");
      }),
      withTargetPace("https://example.com/b", async () => {
        order.push("second-start");
      }),
    ]);
    assert.deepEqual(order, ["first-start", "first-end", "second-start"]);
  } finally {
    if (previousConcurrency === undefined) delete process.env.SCAN_TARGET_CONCURRENCY;
    else process.env.SCAN_TARGET_CONCURRENCY = previousConcurrency;
    if (previousInterval === undefined) delete process.env.SCAN_TARGET_MIN_INTERVAL_MS;
    else process.env.SCAN_TARGET_MIN_INTERVAL_MS = previousInterval;
    resetTargetPaceForTests();
  }
});

test("abuse export keeps who, when, target, and method, and drops the ownership token", () => {
  assert.equal(parseAbuseHost("https://Example.com/path"), "example.com");
  const exported = shapeAbuseExport({
    host: "example.com",
    exportedAt: "2026-10-27T00:00:00.000Z",
    authorizations: [
      {
        id: "auth-1",
        userId: "user-1",
        userEmail: "owner@example.com",
        projectId: "project-1",
        scanId: "scan-1",
        targetUrl: "https://example.com",
        host: "example.com",
        kind: "consent",
        method: "checkbox",
        note: "I consent",
        createdAt: "2026-10-27T00:00:00.000Z",
      },
      {
        id: "other",
        userId: "user-2",
        userEmail: "other@example.com",
        projectId: null,
        scanId: null,
        targetUrl: "https://other.example",
        host: "other.example",
        kind: "ownership",
        method: "dns_txt",
        note: null,
        createdAt: "2026-10-27T00:00:00.000Z",
      },
    ],
    scans: [
      {
        id: "scan-1",
        userId: "user-1",
        userEmail: "owner@example.com",
        projectId: "project-1",
        targetUrl: "https://example.com",
        status: "completed",
        consentAt: "2026-10-27T00:00:00.000Z",
        consentText: "I consent",
        createdAt: "2026-10-27T00:00:00.000Z",
        startedAt: null,
        finishedAt: null,
      },
    ],
    projects: [
      {
        id: "project-1",
        userId: "user-1",
        userEmail: "owner@example.com",
        targetUrl: "https://example.com",
        host: "example.com",
        ownershipMethod: "well_known",
        ownershipVerifiedAt: "2026-10-27T00:00:00.000Z",
        createdAt: "2026-10-27T00:00:00.000Z",
      },
    ],
  });
  const serialized = JSON.stringify(exported);
  assert.equal(exported.authorizations.length, 1);
  assert.equal(exported.authorizations[0]?.userEmail, "owner@example.com");
  assert.equal(exported.authorizations[0]?.method, "checkbox");
  assert.equal(exported.scans.length, 1);
  assert.equal(exported.projects[0]?.ownershipMethod, "well_known");
  assert.equal(serialized.includes("ownershipToken"), false);
  assert.equal(serialized.includes("other.example"), false);
});
