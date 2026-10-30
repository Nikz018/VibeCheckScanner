import {
  buildProof,
  sanitizeDetail,
  type FindingDetail,
  type FindingLocation,
} from "@/lib/finding-detail";
import { originOf, safeFetch, type ProbeResponse } from "@/lib/http";
import { scrubCredentialText, stripSensitiveQuery } from "@/lib/mask-secrets";
import type { Severity } from "@/lib/catalog";
import type { AdvisoryRef, CheckRunState, Confidence, RawCheckResult } from "@/lib/report";

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
  /** HTML pages that referenced this script. Inline scripts point at their page. */
  pageUrls?: string[];
}

const MAX_AFFECTED_PAGES = 25;

export class ScanContext {
  readonly targetUrl: string;
  readonly origin: string;
  readonly mode: "full" | "mini";
  readonly reportAccess: "teaser" | "full";
  home: ProbeResponse | null = null;
  corsProbe: ProbeResponse | null = null;
  html = "";
  pages: ProbeResponse[] = [];
  pagesScanned = 0;
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
  notices: string[] = [];
  onPagesDiscovered: ((count: number) => void | Promise<void>) | null = null;
  private secretValues: string[] = [];

  constructor(targetUrl: string, mode: "full" | "mini", reportAccess?: "teaser" | "full") {
    this.targetUrl = targetUrl;
    this.origin = originOf(targetUrl);
    this.mode = mode;
    this.reportAccess = reportAccess ?? (mode === "full" ? "full" : "teaser");
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

  setMark(checkId: string, state: CheckRunState): void {
    this.marked[checkId] = state;
  }

  note(message: string): void {
    const clean = this.scrub(message).trim();
    if (!clean || this.notices.includes(clean)) return;
    this.notices.push(clean);
  }

  rememberSecret(value: string | null | undefined): void {
    const trimmed = value?.trim() ?? "";
    if (trimmed.length < 6) return;
    if (this.secretValues.includes(trimmed)) return;
    this.secretValues.push(trimmed);
  }

  scrub(text: string): string {
    return scrubCredentialText(text, this.secretValues);
  }

  failUnchecked(checkIds: string[]): void {
    for (const checkId of checkIds) {
      if (!this.marked[checkId]) this.marked[checkId] = "error";
    }
  }

  add(
    checkId: string,
    evidence: string,
    detail: FindingDetail,
    confidence?: Confidence,
    affectedPages?: string[],
    extra?: {
      separate?: boolean;
      severity?: Severity;
      title?: string;
      impact?: string;
      fix?: string;
      advisories?: AdvisoryRef[];
    },
  ): void {
    this.mark(checkId);
    const clean = sanitizeDetail(this.applySecrets(detail));
    const cleanEvidence = this.scrub(evidence);
    const pages = this.cleanPages(affectedPages);
    if (extra?.separate) {
      const title = extra.title ? this.scrub(extra.title) : undefined;
      const impact = extra.impact ? this.scrub(extra.impact) : undefined;
      const fix = extra.fix ? this.scrub(extra.fix) : undefined;
      this.results.push({
        checkId,
        evidence: cleanEvidence,
        locations: clean.locations,
        proof: clean.proof,
        steps: clean.steps,
        ...(confidence ? { confidence } : {}),
        ...(pages.length > 0 ? { affectedPages: pages } : {}),
        ...(extra.severity ? { severity: extra.severity } : {}),
        ...(title ? { title } : {}),
        ...(impact ? { impact } : {}),
        ...(fix ? { fix } : {}),
        ...(extra.advisories && extra.advisories.length > 0 ? { advisories: extra.advisories } : {}),
      });
      return;
    }
    const existing = this.results.find((result) => result.checkId === checkId);
    if (existing) {
      existing.evidence = this.scrub(`${existing.evidence} ${cleanEvidence}`);
      existing.locations = mergeLocations(existing.locations ?? [], clean.locations);
      existing.confidence = higherConfidence(existing.confidence, confidence);
      existing.affectedPages = mergePages(existing.affectedPages, pages);
      return;
    }
    this.results.push({
      checkId,
      evidence: cleanEvidence,
      locations: clean.locations,
      proof: clean.proof,
      steps: clean.steps,
      ...(confidence ? { confidence } : {}),
      ...(pages.length > 0 ? { affectedPages: pages } : {}),
    });
  }

  /** Public URL to show for an inline or external script. */
  scriptUrl(url: string): string {
    if (!url || url === "source" || url.startsWith("rendered:")) return this.home?.url || this.targetUrl;
    if (url.startsWith("inline:")) {
      const rest = url.slice("inline:".length);
      const hash = rest.lastIndexOf("#");
      const page = (hash >= 0 ? rest.slice(0, hash) : rest).trim();
      if (page.startsWith("http://") || page.startsWith("https://")) return page;
      return this.home?.url || this.targetUrl;
    }
    return url;
  }

  /** Pages whose HTML or scripts match. Used to dedupe one finding across the crawl. */
  pagesMatching(pattern: RegExp): string[] {
    const expression = new RegExp(pattern.source, pattern.flags.replace("g", ""));
    const found: string[] = [];
    const add = (url: string) => {
      const clean = stripSensitiveQuery(this.scrub(url));
      if (!clean.startsWith("http") || found.includes(clean)) return;
      if (found.length >= MAX_AFFECTED_PAGES) return;
      found.push(clean);
    };
    for (const script of this.scripts) {
      if (!expression.test(script.body)) continue;
      const pages = script.pageUrls?.length ? script.pageUrls : [this.scriptUrl(script.url)];
      for (const page of pages) add(page);
    }
    for (const page of this.pages) {
      if (expression.test(page.body)) add(page.url);
    }
    return found;
  }

  private cleanPages(pages: string[] | undefined): string[] {
    const found: string[] = [];
    for (const page of pages ?? []) {
      const clean = stripSensitiveQuery(this.scrub(page));
      if (!clean.startsWith("http") || found.includes(clean)) continue;
      found.push(clean);
      if (found.length >= MAX_AFFECTED_PAGES) break;
    }
    return found;
  }

  detailFor(
    responseInput: ProbeResponse,
    options: {
      method?: string;
      requestHeaders?: Record<string, string>;
      locations?: FindingLocation[];
      steps: string[];
      snippetLines?: string[];
    },
  ): FindingDetail {
    const method = (options.method ?? "GET").toUpperCase();
    const response = {
      ...responseInput,
      url: stripSensitiveQuery(this.scrub(responseInput.url)),
      body: this.scrub(responseInput.body),
    };
    const locations = (options.locations ?? [{ method, url: response.url }]).map((location) => ({
      ...location,
      url: stripSensitiveQuery(this.scrub(location.url)),
    }));
    const headers = Object.fromEntries(
      Object.entries(options.requestHeaders ?? {}).map(([name, value]) => [name, this.scrub(value)]),
    );
    return {
      locations,
      proof: buildProof({
        method,
        url: response.url,
        requestHeaders: headers,
        response,
        snippetLines: (options.snippetLines ?? []).map((line) => this.scrub(line)),
      }),
      steps: options.steps.map((step) => this.scrub(step)),
    };
  }

  private applySecrets(detail: FindingDetail): FindingDetail {
    return {
      locations: detail.locations.map((location) => ({
        ...location,
        url: stripSensitiveQuery(this.scrub(location.url)),
      })),
      proof: {
        ...detail.proof,
        url: stripSensitiveQuery(this.scrub(detail.proof.url)),
        responseSnippet: this.scrub(detail.proof.responseSnippet),
        headers: detail.proof.headers.map((header) => ({ name: header.name, value: this.scrub(header.value) })),
      },
      steps: detail.steps.map((step) => this.scrub(step)),
    };
  }

  scriptText(): string {
    return [this.html, ...this.pages.map((page) => page.body), ...this.scripts.map((script) => script.body)].join("\n");
  }
}

function higherConfidence(current: Confidence | undefined, next: Confidence | undefined): Confidence | undefined {
  const rank: Record<Confidence, number> = { low: 1, medium: 2, high: 3 };
  if (!next) return current;
  if (!current) return next;
  return rank[next] > rank[current] ? next : current;
}

function mergePages(current: string[] | undefined, extra: string[]): string[] | undefined {
  if (extra.length === 0) return current;
  const merged = [...(current ?? [])];
  const seen = new Set(merged);
  for (const page of extra) {
    if (seen.has(page)) continue;
    seen.add(page);
    merged.push(page);
    if (merged.length >= MAX_AFFECTED_PAGES) break;
  }
  return merged;
}

function mergeLocations(current: FindingLocation[], extra: FindingLocation[]): FindingLocation[] {
  const seen = new Set(current.map((location) => `${location.method} ${location.url} ${location.line ?? ""}`));
  const merged = [...current];
  for (const location of extra) {
    const key = `${location.method} ${location.url} ${location.line ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(location);
  }
  return merged.slice(0, 6);
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
