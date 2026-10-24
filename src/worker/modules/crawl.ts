import { readdirSync, readFileSync } from "node:fs";
import { extractAssets, extractConfig, extractInlineScripts } from "../extract";
import type { ScanContext } from "../context";

export async function runCrawl(ctx: ScanContext): Promise<void> {
  ctx.home = await ctx.fetch(ctx.targetUrl, {
    headers: { accept: "text/html" },
  });
  ctx.html = ctx.home.body;
  ctx.corsProbe = await ctx.fetch(ctx.origin, {
    headers: {
      accept: "text/html",
      origin: "https://vibecheck-probe.example",
    },
  });

  const base = new URL(ctx.origin);
  const assets = extractAssets(ctx.html, base);
  const inline = extractInlineScripts(ctx.html).map((body, index) => ({ url: `inline:${index + 1}`, body }));
  const scripts = [...inline];
  const sameOrigin = assets.scripts.filter((url) => {
    try {
      return new URL(url).origin === base.origin;
    } catch {
      return false;
    }
  });

  for (const url of sameOrigin.slice(0, 12)) {
    try {
      const response = await ctx.fetch(url, { maxBytes: 500_000 });
      if (response.status === 200 && response.body) scripts.push({ url, body: response.body });
    } catch (error) {
      console.error(`script fetch skipped: ${error instanceof Error ? error.message : "error"}`);
    }
  }
  ctx.scripts = scripts;

  if (ctx.mode === "full") {
    const budget = browserBudgetMs();
    const rendered = await Promise.race([
      renderWithBrowser(ctx.targetUrl, budget),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), budget + 1500)),
    ]);
    if (rendered?.html) {
      const extra = extractInlineScripts(rendered.html);
      extra.forEach((body, index) => scripts.push({ url: `rendered:${index + 1}`, body }));
      ctx.scripts = scripts;
      console.log("headless render finished");
    }
  }

  ctx.config = extractConfig(ctx.scripts, ctx.origin);
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
    const page = await browser.newPage({ userAgent: "VibeCheckScanner/0.1" });
    page.setDefaultNavigationTimeout(remaining);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: remaining });
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
