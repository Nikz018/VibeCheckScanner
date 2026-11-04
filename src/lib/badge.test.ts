import assert from "node:assert/strict";
import test from "node:test";
import { POINT_IN_TIME_DISCLAIMER, badgeLabel, isScanStale, renderBadgeSvg } from "./badge";
import { formatScoreRatio, renderScoreGaugeSvg, scoreBand } from "./score-gauge";

const scanned = new Date("2026-09-01T00:00:00.000Z");
const freshNow = new Date("2026-09-10T00:00:00.000Z");
const staleNow = new Date("2026-10-15T00:00:00.000Z");

test("badge is fresh for 30 days and then asks for a rescan", () => {
  assert.equal(isScanStale(scanned, freshNow, 30), false);
  assert.equal(isScanStale(scanned, staleNow, 30), true);
  const fresh = renderBadgeSvg({ score: 96, finishedAt: scanned, passed: true, stale: false });
  const stale = renderBadgeSvg({ score: 96, finishedAt: scanned, passed: true, stale: true });
  const low = renderBadgeSvg({ score: 7, finishedAt: scanned, passed: false, stale: false });
  assert.match(fresh, /VibeCheck 96\/100/);
  assert.match(fresh, new RegExp(scoreBand(96).color));
  assert.match(fresh, /Scanned/);
  assert.doesNotMatch(fresh, /rescan needed/);
  assert.doesNotMatch(fresh, /Passed VibeCheck/);
  assert.doesNotMatch(fresh, /VibeCheck score/);
  assert.match(stale, /rescan needed/);
  assert.match(stale, /VibeCheck 96\/100/);
  assert.match(stale, /1 Sept 2026/);
  assert.match(low, /VibeCheck 7\/100/);
  assert.match(low, new RegExp(scoreBand(7).color));
  assert.equal(badgeLabel({ score: 72, finishedAt: scanned, passed: false, stale: false }), "VibeCheck 72/100");
});

test("score bands and the gauge read as a ratio out of 100", () => {
  assert.equal(scoreBand(0).label, "Critical risk");
  assert.equal(scoreBand(39).label, "Critical risk");
  assert.equal(scoreBand(40).label, "Needs work");
  assert.equal(scoreBand(69).label, "Needs work");
  assert.equal(scoreBand(70).label, "Good");
  assert.equal(scoreBand(89).label, "Good");
  assert.equal(scoreBand(90).label, "Strong");
  assert.equal(scoreBand(100).label, "Strong");
  assert.equal(formatScoreRatio(7), "7/100");
  const gauge = renderScoreGaugeSvg({ score: 7 });
  assert.match(gauge, /7\/100/);
  assert.match(gauge, /Critical risk/);
  assert.match(gauge, /stroke-dasharray="7 100"/);
  assert.match(gauge, new RegExp(scoreBand(7).color));
  assert.doesNotMatch(gauge, />7</);
});

test("score rating colors stay on the original palette", () => {
  assert.equal(scoreBand(20).color, "#e24b3a");
  assert.equal(scoreBand(50).color, "#e09a14");
  assert.equal(scoreBand(80).color, "#9bb42a");
  assert.equal(scoreBand(95).color, "#2f9e5a");
  for (const tone of ["dark", "light"] as const) {
    const good = renderScoreGaugeSvg({ score: 80, tone });
    assert.match(good, /#9bb42a/);
    assert.doesNotMatch(good, /#ff6a3d/);
    assert.doesNotMatch(good, /#c4471a/);
    assert.match(renderScoreGaugeSvg({ score: 20, tone }), /#e24b3a/);
    assert.match(renderScoreGaugeSvg({ score: 50, tone }), /#e09a14/);
    assert.match(renderScoreGaugeSvg({ score: 95, tone }), /#2f9e5a/);
  }
  const badge = renderBadgeSvg({ score: 80, finishedAt: scanned, passed: true, stale: false });
  assert.match(badge, /#9bb42a/);
  assert.doesNotMatch(badge, /#ff6a3d/);
});

test("share disclaimer is point-in-time and not a certification", () => {
  assert.match(POINT_IN_TIME_DISCLAIMER, /point in time/i);
  assert.match(POINT_IN_TIME_DISCLAIMER, /not a guarantee/i);
  assert.doesNotMatch(POINT_IN_TIME_DISCLAIMER, /SOC|HIPAA|PCI/i);
});
