export const SCAN_STAGES = [
  { id: "ownership", label: "Verifying ownership" },
  { id: "discover", label: "Discovering pages" },
  { id: "headers", label: "Checking headers & TLS" },
  { id: "scripts", label: "Inspecting scripts" },
  { id: "exposure", label: "Checking exposed files" },
  { id: "routes", label: "Checking application routes" },
  { id: "code", label: "Scanning your code" },
  { id: "report", label: "Building report" },
] as const;

export type ScanStageId = (typeof SCAN_STAGES)[number]["id"];

const STAGE_IDS = new Set<string>(SCAN_STAGES.map((stage) => stage.id));

export function isScanStageId(value: string | null | undefined): value is ScanStageId {
  return typeof value === "string" && STAGE_IDS.has(value);
}

/** Stages the worker actually runs for this mode. Mini scans stop before application-route checks. Code scan is only listed when this job will read a repository. */
export function stagesForMode(mode: string, options?: { codeScan?: boolean }): Array<(typeof SCAN_STAGES)[number]> {
  return SCAN_STAGES.filter((stage) => {
    if (stage.id === "routes" && mode !== "full") return false;
    if (stage.id === "code" && !options?.codeScan) return false;
    return true;
  });
}

export function stageState(input: {
  mode: string;
  stage: string | null | undefined;
  status: string;
  codeScan?: boolean;
}): Array<{ id: ScanStageId; label: string; state: "done" | "current" | "pending" }> {
  const stages = stagesForMode(input.mode, { codeScan: input.codeScan });
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
export function progressPercent(input: { mode: string; stage: string | null | undefined; status: string; codeScan?: boolean }): number {
  if (input.status === "completed") return 100;
  const stages = stagesForMode(input.mode, { codeScan: input.codeScan });
  const known = isScanStageId(input.stage) ? input.stage : input.status === "queued" || input.status === "running" ? "ownership" : null;
  const index = known ? stages.findIndex((stage) => stage.id === known) : -1;
  if (index < 0) return 0;
  if (input.status === "failed") return Math.round((index / stages.length) * 100);
  return Math.min(96, Math.round(((index + 0.4) / stages.length) * 100));
}
