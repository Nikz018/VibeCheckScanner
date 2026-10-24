import assert from "node:assert/strict";
import test from "node:test";
import { computeScore, isPassingScore } from "./score";

test("score starts at 100 and floors at 0", () => {
  assert.equal(computeScore([]), 100);
  assert.equal(computeScore([{ severity: "critical" }, { severity: "critical" }, { severity: "critical" }, { severity: "critical" }]), 0);
  assert.equal(computeScore([{ severity: "high" }, { severity: "low" }]), 86);
});

test("passing requires a high score and no serious findings", () => {
  assert.equal(isPassingScore(100, []), true);
  assert.equal(isPassingScore(90, [{ severity: "high" }]), false);
  assert.equal(isPassingScore(70, [{ severity: "medium" }]), false);
  assert.equal(isPassingScore(86, [{ severity: "low" }]), true);
});
