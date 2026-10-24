import assert from "node:assert/strict";
import test from "node:test";
import { POINT_IN_TIME_DISCLAIMER, badgeLabel, isScanStale, renderBadgeSvg } from "./badge";

const scanned = new Date("2026-09-01T00:00:00.000Z");
const freshNow = new Date("2026-09-10T00:00:00.000Z");
const staleNow = new Date("2026-10-15T00:00:00.000Z");

test("badge is fresh for 30 days and then asks for a rescan", () => {
  assert.equal(isScanStale(scanned, freshNow, 30), false);
  assert.equal(isScanStale(scanned, staleNow, 30), true);
  const fresh = renderBadgeSvg({ score: 96, finishedAt: scanned, passed: true, stale: false });
  const stale = renderBadgeSvg({ score: 96, finishedAt: scanned, passed: true, stale: true });
  assert.match(fresh, /Passed VibeCheck/);
  assert.match(fresh, /Scanned/);
  assert.doesNotMatch(fresh, /rescan needed/);
  assert.match(stale, /rescan needed/);
  assert.match(stale, /1 Sept 2026/);
  assert.equal(badgeLabel({ score: 72, finishedAt: scanned, passed: false, stale: false }), "VibeCheck score 72");
});

test("share disclaimer is point-in-time and not a certification", () => {
  assert.match(POINT_IN_TIME_DISCLAIMER, /point in time/i);
  assert.match(POINT_IN_TIME_DISCLAIMER, /not a guarantee/i);
  assert.doesNotMatch(POINT_IN_TIME_DISCLAIMER, /SOC|HIPAA|PCI/i);
});
