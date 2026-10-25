import type { AuthScanPayload } from "@/lib/auth-input";
import { assertProbeAllowed } from "@/lib/http";
import { LOGIN_AVAILABLE_NOTICE } from "@/lib/limitations";
import type { CheckRunState, RawCheckResult } from "@/lib/report";
import { ScanContext } from "./context";
import { runAccess } from "./modules/access";
import { runAuthenticated, skipAuthenticated } from "./modules/authenticated";
import { runAuthConfig } from "./modules/authcfg";
import { runFirebase, runStorage, runSupabase } from "./modules/backends";
import { runCrawl } from "./modules/crawl";
import { runDependencies } from "./modules/dependencies";
import { runExposure } from "./modules/exposure";
import { runHeaders } from "./modules/headers";
import { runInjection } from "./modules/injection";
import { runLlm } from "./modules/llm";
import { runSecrets } from "./modules/secrets";

export interface PipelineOutput {
  results: RawCheckResult[];
  marked: Record<string, CheckRunState>;
  notices: string[];
}

export async function runScanPipeline(options: {
  targetUrl: string;
  mode: "full" | "mini";
  ownershipConfirmed: boolean;
  auth?: AuthScanPayload | null;
  authError?: string | null;
  reportAccess?: "teaser" | "full";
}): Promise<PipelineOutput> {
  if (options.ownershipConfirmed !== true) {
    throw new Error("Ownership proof and consent are required before an active scan");
  }
  const origin = new URL(options.targetUrl).origin;
  await assertProbeAllowed(options.targetUrl, origin);
  const ctx = new ScanContext(options.targetUrl, options.mode);
  await runCrawl(ctx);
  await runHeaders(ctx);
  await runExposure(ctx);
  if (options.mode === "full") {
    await runSecrets(ctx);
    await runDependencies(ctx);
    await runSupabase(ctx);
    await runFirebase(ctx);
    await runStorage(ctx);
    await runAccess(ctx);
    await runAuthConfig(ctx);
    await runLlm(ctx);
    await runInjection(ctx);
    if (options.reportAccess === "teaser") skipAuthenticated(ctx, LOGIN_AVAILABLE_NOTICE);
    else if (options.authError) skipAuthenticated(ctx, options.authError);
    else await runAuthenticated(ctx, options.auth ?? null);
  }
  return { results: ctx.results, marked: ctx.marked, notices: ctx.notices };
}
