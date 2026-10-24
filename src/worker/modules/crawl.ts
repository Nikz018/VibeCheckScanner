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
    const rendered = await renderWithBrowser(ctx.targetUrl);
    if (rendered?.html) {
      const extra = extractInlineScripts(rendered.html);
      extra.forEach((body, index) => scripts.push({ url: `rendered:${index + 1}`, body }));
      ctx.scripts = scripts;
    }
  }

  ctx.config = extractConfig(ctx.scripts, ctx.origin);
}

async function renderWithBrowser(url: string): Promise<{ html: string } | null> {
  if (process.env.PLAYWRIGHT_ENABLED === "false") return null;
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    try {
      const page = await browser.newPage({ userAgent: "VibeCheckScanner/0.1" });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      const html = await page.content();
      return { html };
    } finally {
      await browser.close();
    }
  } catch (error) {
    console.warn(`headless render unavailable: ${error instanceof Error ? error.message : "error"}`);
    return null;
  }
}
