import { progressPercent, stageState } from "./scan-progress";

/** Status payload for the scan poll endpoint. Finding bodies are never copied onto it. */
export function publicScanStatus(input: {
  status: string;
  error: string | null;
  mode: string;
  stage: string | null;
  pagesDiscovered: number;
  startedAt: Date | null;
  createdAt: Date;
  codeScan: boolean;
  codeReport: unknown;
}): {
  status: string;
  error: string | null;
  mode: string;
  stage: string | null;
  pagesDiscovered: number;
  startedAt: string | null;
  createdAt: string;
  codeScan: boolean;
  codeStatus: string | null;
  progress: number;
  stages: ReturnType<typeof stageState>;
} {
  return {
    status: input.status,
    error: input.error,
    mode: input.mode,
    stage: input.stage,
    pagesDiscovered: input.pagesDiscovered,
    startedAt: input.startedAt ? input.startedAt.toISOString() : null,
    createdAt: input.createdAt.toISOString(),
    codeScan: input.codeScan,
    codeStatus: readCodeStatus(input.codeReport),
    progress: progressPercent({ mode: input.mode, stage: input.stage, status: input.status, codeScan: input.codeScan }),
    stages: stageState({ mode: input.mode, stage: input.stage, status: input.status, codeScan: input.codeScan }),
  };
}

function readCodeStatus(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("status" in value)) return null;
  const status = (value as { status?: unknown }).status;
  return typeof status === "string" ? status : null;
}
