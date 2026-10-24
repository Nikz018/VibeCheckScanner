import { originOf, safeFetch, type ProbeResponse } from "@/lib/http";
import type { CheckRunState, RawCheckResult } from "@/lib/report";

export interface DiscoveredConfig {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  serviceRoleKey: string | null;
  firebaseDatabaseUrl: string | null;
  firebaseProjectId: string | null;
}

export interface ScriptDocument {
  url: string;
  body: string;
}

export class ScanContext {
  readonly targetUrl: string;
  readonly origin: string;
  readonly mode: "full" | "mini";
  home: ProbeResponse | null = null;
  corsProbe: ProbeResponse | null = null;
  html = "";
  scripts: ScriptDocument[] = [];
  packageJson: string | null = null;
  config: DiscoveredConfig = {
    supabaseUrl: null,
    supabaseAnonKey: null,
    serviceRoleKey: null,
    firebaseDatabaseUrl: null,
    firebaseProjectId: null,
  };
  results: RawCheckResult[] = [];
  marked: Record<string, CheckRunState> = {};

  constructor(targetUrl: string, mode: "full" | "mini") {
    this.targetUrl = targetUrl;
    this.origin = originOf(targetUrl);
    this.mode = mode;
  }

  async fetch(
    pathOrUrl: string,
    init: {
      method?: "GET" | "HEAD" | "OPTIONS" | "POST";
      headers?: Record<string, string>;
      body?: string;
      follow?: boolean;
      maxBytes?: number;
    } = {},
  ): Promise<ProbeResponse> {
    const url = pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://") ? pathOrUrl : new URL(pathOrUrl, this.origin).toString();
    return safeFetch({
      url,
      targetOrigin: this.origin,
      ...init,
    });
  }

  mark(checkId: string): void {
    if (!this.marked[checkId]) this.marked[checkId] = "ok";
  }

  failUnchecked(checkIds: string[]): void {
    for (const checkId of checkIds) {
      if (!this.marked[checkId]) this.marked[checkId] = "error";
    }
  }

  add(checkId: string, evidence: string): void {
    this.mark(checkId);
    const existing = this.results.find((result) => result.checkId === checkId);
    if (existing) {
      existing.evidence = `${existing.evidence} ${evidence}`;
      return;
    }
    this.results.push({ checkId, evidence });
  }

  scriptText(): string {
    return [this.html, ...this.scripts.map((script) => script.body)].join("\n");
  }
}

export async function runModule(checkIds: string[], ctx: ScanContext, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    for (const checkId of checkIds) ctx.mark(checkId);
  } catch (error) {
    ctx.failUnchecked(checkIds);
    const message = error instanceof Error ? error.message : "check failed";
    console.error(`module failed (${checkIds[0] ?? "unknown"}): ${message}`);
  }
}
