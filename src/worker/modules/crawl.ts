import { readdirSync, readFileSync } from "node:fs";
import { scannerUserAgent } from "@/lib/scanner-identity";
import { withTargetPace } from "@/lib/target-pace";
import type { ProbeResponse } from "@/lib/http";
import {
  crawlBudget,
  classifyDiscoveredUrl,
  extractAnchorHrefs,
  isBinaryResponse,
  isHtmlDocument,
  isNonScriptAsset,
  isSkippedPublicFile,
  isVerifiedOrigin,
  normalizePublicUrl,
  parseRobots,
  parseSitemapXml,
  robotsAllows,
  UrlDeduper,
  type RobotsRules,
} from "../crawl-policy";
import { extractAssets, extractConfig, extractInlineScripts } from "../extract";
import { isActionUrl } from "../readonly";
import type { ScanContext, ScriptDocument } from "../context";

/**
 * Public crawl. GET only, same origin as the verified target, paced by the shared
 * target lane. The explicit target is always fetched. Discovered URLs are not.
 */
export async function runCrawl(ctx: ScanContext): Promise<void> {
  const limits = crawlBudget(ctx.mode, ctx.reportAccess);
  const budget = { requests: 0, started: Date.now() };
  const deduper = new UrlDeduper(limits.maxQueryVariants);
  const pageQueue: string[] = [];
  const sitemapQueue: string[] = [];
  const fetched = new Set<string>();
  const rules: RobotsRules = { allow: [], disallow: [], sitemaps: [] };
  const target = normalizePublicUrl(ctx.targetUrl, ctx.origin) ?? ctx.targetUrl;
  deduper.accept(target);

  const openRules: RobotsRules = { allow: [], disallow: [], sitemaps: [] };
  const remember = (raw: string, base: string, lane: "page" | "sitemap", ignoreRobots = false): void => {
    const normalized = classifyDiscoveredUrl(raw, base, ctx.origin, ignoreRobots ? openRules : rules);
    if (!normalized || fetched.has(normalized)) return;
    if (pageQueue.length + sitemapQueue.length >= limits.maxPages * 10) return;
    if (!deduper.accept(normalized)) return;
    const bucket = lane === "page" ? pageQueue : sitemapQueue;
    bucket.push(normalized);
  };

  const withinBudget = () => budget.requests < limits.maxRequests && Date.now() - budget.started < limits.maxMs;

  const fetchGet = async (
    url: string,
    accept: string,
    required: boolean,
  ): Promise<ProbeResponse | null> => {
    if (!isVerifiedOrigin(url, ctx.origin)) return null;
    if (!withinBudget()) {
      if (required) throw new Error("The target page was not fetched before the crawl budget ended");
      return null;
    }
    budget.requests += 1;
    try {
      return await ctx.fetch(url, {
        method: "GET",
        headers: { accept },
        follow: false,
        maxBytes: accept.includes("html") ? 400_000 : 500_000,
      });
    } catch (error) {
      if (required) throw error;
      console.error(`page fetch skipped: ${error instanceof Error ? error.message : "error"}`);
      return null;
    }
  };

  const robotsUrl = new URL("/robots.txt", ctx.origin).toString();
  const robots = await fetchGet(robotsUrl, "text/plain", false);
  const parsedRules = parseRobots(robots?.status === 200 ? robots.body : "", scannerUserAgent());
  rules.allow = parsedRules.allow;
  rules.disallow = parsedRules.disallow;
  rules.sitemaps = parsedRules.sitemaps;

  const sitemapSeeds = [new URL("/sitemap.xml", ctx.origin).toString(), ...rules.sitemaps];
  const seenSitemaps = new Set<string>();
  let sitemapFiles = 0;
  const sitemapWork = [...sitemapSeeds];
  while (sitemapWork.length > 0 && sitemapFiles < limits.maxSitemaps && withinBudget()) {
    const next = normalizePublicUrl(sitemapWork.shift() ?? "", ctx.origin);
    if (!next || seenSitemaps.has(next) || !isVerifiedOrigin(next, ctx.origin)) continue;
    seenSitemaps.add(next);
    const response = await fetchGet(next, "application/xml, text/xml, text/plain", false);
    sitemapFiles += 1;
    if (!response || response.status !== 200 || isBinaryResponse(response.headers["content-type"], response.headers["content-disposition"])) {
      continue;
    }
    const parsed = parseSitemapXml(response.body);
    for (const child of parsed.sitemaps) sitemapWork.push(child);
    for (const page of parsed.pages) remember(page, next, "sitemap");
  }

  const targetResponse = await fetchGet(target, "text/html, application/xhtml+xml", true);
  if (!targetResponse) throw new Error("The target page was not fetched");

  const pages: ProbeResponse[] = [];
  const scripts: ScriptDocument[] = [];
  const scriptSeen = new Set<string>();
  let externalScripts = 0;
  let inlineScripts = 0;

  const takePage = async (response: ProbeResponse | null): Promise<void> => {
    if (!response) return;
    if (isRedirect(response)) {
      if (response.location) remember(response.location, response.url, "page");
      return;
    }
    if (isBinaryResponse(response.headers["content-type"], response.headers["content-disposition"])) return;
    if (!isHtmlDocument(response.headers["content-type"], response.body)) return;
    if (!isVerifiedOrigin(response.url, ctx.origin)) return;
    const canonical = normalizePublicUrl(response.url, ctx.origin);
    if (canonical) fetched.add(canonical);
    fetched.add(response.url);
    pages.push(response);
    for (const href of extractAnchorHrefs(response.body)) remember(href, response.url, "page");
    await collectScripts(response);
  };

  const collectScripts = async (page: ProbeResponse): Promise<void> => {
    const inline = extractInlineScripts(page.body);
    for (const body of inline) {
      if (inlineScripts >= limits.maxInlineScripts) break;
      inlineScripts += 1;
      scripts.push({ url: `inline:${page.url}#${inlineScripts}`, body, pageUrls: [page.url] });
    }
    const assets = extractAssets(page.body, new URL(page.url));
    let fetchedForPage = 0;
    for (const raw of assets.scripts) {
      if (externalScripts >= limits.maxScripts || fetchedForPage >= limits.maxScriptsPerPage) break;
      const normalized = normalizePublicUrl(raw, page.url);
      if (!normalized || !isVerifiedOrigin(normalized, ctx.origin)) continue;
      if (isActionUrl(normalized) || isNonScriptAsset(normalized)) continue;
      const existing = scripts.find((script) => script.url === normalized);
      if (existing) {
        if (!existing.pageUrls) existing.pageUrls = [];
        if (!existing.pageUrls.includes(page.url)) existing.pageUrls.push(page.url);
        continue;
      }
      if (scriptSeen.has(normalized)) continue;
      scriptSeen.add(normalized);
      const response = await fetchGet(normalized, "*/*", false);
      if (!response || response.status !== 200 || !response.body) continue;
      if (isRedirect(response)) continue;
      if (isBinaryResponse(response.headers["content-type"], response.headers["content-disposition"])) continue;
      if (!isVerifiedOrigin(response.url, ctx.origin)) continue;
      scripts.push({ url: response.url, body: response.body, pageUrls: [page.url] });
      externalScripts += 1;
      fetchedForPage += 1;
    }
  };

  if (isVerifiedOrigin(targetResponse.url, ctx.origin)) {
    ctx.home = targetResponse;
    ctx.html = targetResponse.body;
  }
  await takePage(targetResponse);

  fetched.add(target);
  while ((pageQueue.length > 0 || sitemapQueue.length > 0) && pages.length < limits.maxPages && withinBudget()) {
    const url = pageQueue.length > 0 ? pageQueue.shift() : sitemapQueue.shift();
    if (!url || fetched.has(url)) continue;
    fetched.add(url);
    if (!isVerifiedOrigin(url, ctx.origin) || isActionUrl(url) || isSkippedPublicFile(url)) continue;
    if (!robotsAllows(url, rules) && url !== target) continue;
    const response = await fetchGet(url, "text/html, application/xhtml+xml", false);
    await takePage(response);
  }

  ctx.pages = pages;
  ctx.pagesScanned = pages.length;
  if (!ctx.home) {
    ctx.home = targetResponse;
    ctx.html = targetResponse.body;
  }
  if (pages.length >= limits.maxPages && (pageQueue.length > 0 || sitemapQueue.length > 0)) {
    ctx.note(`Scanned ${pages.length} pages and stopped at the page limit. Other pages on this origin were not scanned.`);
  }

  ctx.corsProbe = await ctx.fetch(ctx.origin, {
    headers: {
      accept: "text/html",
      origin: "https://vibecheck-probe.example",
    },
  });

  if (ctx.mode === "full") {
    const budgetMs = browserBudgetMs();
    const rendered = await Promise.race([
      renderWithBrowser(ctx.targetUrl, budgetMs),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), budgetMs + 1500)),
    ]);
    if (rendered?.html) {
      const extra = extractInlineScripts(rendered.html);
      extra.forEach((body, index) => {
        scripts.push({ url: `rendered:${index + 1}`, body, pageUrls: [ctx.home?.url || ctx.targetUrl] });
      });
      console.log("headless render finished");
    }
  }

  ctx.scripts = scripts;
  ctx.config = extractConfig(ctx.scripts, ctx.origin);
}

function isRedirect(response: ProbeResponse): boolean {
  return [301, 302, 303, 307, 308].includes(response.status);
}

function browserBudgetMs(): number {
  const raw = Number(process.env.BROWSER_TIMEOUT_MS || 20000);
  return Number.isFinite(raw) && raw >= 3000 ? raw : 20000;
}

type LaunchedBrowser = {
  close: () => Promise<void>;
  newPage: (options: { userAgent: string }) => Promise<{
    setDefaultNavigationTimeout: (timeout: number) => void;
    goto: (url: string, options: { waitUntil: "domcontentloaded"; timeout: number }) => Promise<unknown>;
    content: () => Promise<string>;
  }>;
};

async function renderWithBrowser(url: string, budgetMs: number): Promise<{ html: string } | null> {
  if (process.env.PLAYWRIGHT_ENABLED === "false") return null;
  let browser: LaunchedBrowser | null = null;
  const started = Date.now();
  const killTimer = setTimeout(() => {
    console.warn(`headless render exceeded ${budgetMs}ms; killing the browser`);
    const child = browserProcess(browser);
    if (child && !child.killed) child.kill("SIGKILL");
    killHeadlessDescendants();
  }, budgetMs);
  try {
    const playwright = await import("playwright");
    const channel = process.env.PLAYWRIGHT_CHANNEL?.trim();
    browser = await playwright.chromium.launch({
      headless: true,
      timeout: Math.min(10000, budgetMs),
      ...(channel ? { channel: channel as "chrome" } : {}),
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const remaining = budgetMs - (Date.now() - started);
    if (remaining < 1000) throw new Error("headless render budget exhausted before navigation");
    const page = await browser.newPage({ userAgent: scannerUserAgent() });
    page.setDefaultNavigationTimeout(remaining);
    await withTargetPace(url, () => page.goto(url, { waitUntil: "domcontentloaded", timeout: remaining }));
    const html = await page.content();
    return { html };
  } catch (error) {
    console.warn(`headless render unavailable: ${error instanceof Error ? error.message : "error"}`);
    return null;
  } finally {
    clearTimeout(killTimer);
    killHeadlessDescendants();
    await Promise.race([
      browser?.close().catch(() => undefined) ?? Promise.resolve(),
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]);
  }
}

function browserProcess(browser: LaunchedBrowser | null): { killed?: boolean; kill: (signal?: NodeJS.Signals) => boolean } | null {
  const candidate = browser as { process?: () => { killed?: boolean; kill: (signal?: NodeJS.Signals) => boolean } | null } | null;
  return candidate?.process?.() ?? null;
}

function killHeadlessDescendants(rootPid = process.pid): void {
  for (const pid of descendantPids(rootPid)) {
    let cmd = "";
    try {
      cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8");
    } catch {
      continue;
    }
    if (!/chrome|chromium|headless_shell/i.test(cmd)) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already exited
    }
  }
}

function descendantPids(root: number): number[] {
  const children = new Map<number, number[]>();
  let entries: string[] = [];
  try {
    entries = readdirSync("/proc");
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const ppid = Number(stat.split(" ")[3]);
      const list = children.get(ppid) ?? [];
      list.push(pid);
      children.set(ppid, list);
    } catch {
      // process exited while we were reading
    }
  }
  const out: number[] = [];
  const stack = [...(children.get(root) ?? [])];
  while (stack.length) {
    const pid = stack.pop();
    if (pid === undefined) break;
    out.push(pid);
    stack.push(...(children.get(pid) ?? []));
  }
  return out;
}
