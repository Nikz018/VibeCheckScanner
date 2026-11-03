import assert from "node:assert/strict";
import test from "node:test";
import { progressPercent, stageState, stagesForMode } from "./scan-progress";

test("scan progress follows the stages the worker records", () => {
  const mini = stagesForMode("mini").map((stage) => stage.label);
  assert.deepEqual(mini, [
    "Verifying ownership",
    "Discovering pages",
    "Checking headers & TLS",
    "Inspecting scripts",
    "Checking exposed files",
    "Building report",
  ]);
  assert.equal(stagesForMode("full").some((stage) => stage.id === "routes"), true);
  assert.equal(stagesForMode("mini").some((stage) => stage.id === "routes"), false);
  assert.equal(stagesForMode("full").some((stage) => stage.id === "code"), false);
  const withCode = stagesForMode("full", { codeScan: true });
  assert.equal(withCode.some((stage) => stage.label === "Scanning your code"), true);
  assert.ok(withCode.findIndex((stage) => stage.id === "code") < withCode.findIndex((stage) => stage.id === "report"));
  const coding = stageState({ mode: "full", stage: "code", status: "running", codeScan: true });
  assert.equal(coding.find((stage) => stage.id === "code")?.state, "current");
  assert.equal(coding.find((stage) => stage.id === "routes")?.state, "done");
  assert.equal(coding.find((stage) => stage.id === "report")?.state, "pending");

  const running = stageState({ mode: "full", stage: "discover", status: "running" });
  assert.equal(running.find((stage) => stage.id === "ownership")?.state, "done");
  assert.equal(running.find((stage) => stage.id === "discover")?.state, "current");
  assert.equal(running.find((stage) => stage.id === "headers")?.state, "pending");
  assert.ok(progressPercent({ mode: "full", stage: "discover", status: "running" }) > 0);
  assert.ok(progressPercent({ mode: "full", stage: "discover", status: "running" }) < progressPercent({ mode: "full", stage: "report", status: "running" }));
  assert.equal(progressPercent({ mode: "mini", stage: "report", status: "completed" }), 100);
  assert.equal(progressPercent({ mode: "full", stage: null, status: "queued" }), progressPercent({ mode: "full", stage: "ownership", status: "queued" }));

  const labels = running.map((stage) => stage.label).join("\n");
  assert.doesNotMatch(labels, /nuclei|zap|burp|sqlmap|nmap|playwright|chromium/i);
});
