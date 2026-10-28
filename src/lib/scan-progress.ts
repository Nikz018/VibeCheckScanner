export const SCAN_STAGES = [
  { id: "ownership", label: "Verifying ownership" },
  { id: "discover", label: "Discovering pages" },
  { id: "headers", label: "Checking headers & TLS" },
  { id: "scripts", label: "Inspecting scripts" },
  { id: "exposure", label: "Checking exposed files" },
  { id: "routes", label: "Checking application routes" },
  { id: "report", label: "Building report" },
] as const;

export type ScanStageId = (typeof SCAN_STAGES)[number]["id"];

const STAGE_IDS = new Set<string>(SCAN_STAGES.map((stage) => stage.id));

export function isScanStageId(value: string | null | undefined): value is ScanStageId {
  return typeof value === "string" && STAGE_IDS.has(value);
}

/** Stages the worker actually runs for this mode. Mini scans stop before application-route checks. */
export function stagesForMode(mode: string): Array<(typeof SCAN_STAGES)[number]> {
  if (mode === "full") return [...SCAN_STAGES];
  return SCAN_STAGES.filter((stage) => stage.id !== "routes");
}

export function stageState(input: {
  mode: string;
  stage: string | null | undefined;
  status: string;
}): Array<{ id: ScanStageId; label: string; state: "done" | "current" | "pending" }> {
  const stages = stagesForMode(input.mode);
  const known = isScanStageId(input.stage) ? input.stage : input.status === "queued" || input.status === "running" ? "ownership" : null;
  const index = known ? stages.findIndex((stage) => stage.id === known) : -1;
  return stages.map((stage, stageIndex) => {
    let state: "done" | "current" | "pending" = "pending";
    if (input.status === "completed") state = "done";
    else if (index >= 0 && stageIndex < index) state = "done";
    else if (index >= 0 && stageIndex === index) state = "current";
    return { id: stage.id, label: stage.label, state };
  });
}

/** 0–100 from the stage the worker last recorded. Completed scans are 100. */
export function progressPercent(input: { mode: string; stage: string | null | undefined; status: string }): number {
  if (input.status === "completed") return 100;
  const stages = stagesForMode(input.mode);
  const known = isScanStageId(input.stage) ? input.stage : input.status === "queued" || input.status === "running" ? "ownership" : null;
  const index = known ? stages.findIndex((stage) => stage.id === known) : -1;
  if (index < 0) return 0;
  if (input.status === "failed") return Math.round((index / stages.length) * 100);
  return Math.min(96, Math.round(((index + 0.4) / stages.length) * 100));
}
