import { reproduce } from "@/lib/finding-detail";
import type { ProbeResponse } from "@/lib/http";
import { locateText } from "../extract";
import { runModule, type ScanContext } from "../context";

export const INJECTION_CHECK_IDS = ["reflected_xss", "dom_xss_sink"] as const;

export async function runInjection(ctx: ScanContext): Promise<void> {
  await runModule([...INJECTION_CHECK_IDS], ctx, async () => {
    const marker = "vcZX777<b>";
    const targets = reflectionTargets(ctx);
    const reflected: ProbeResponse[] = [];
    for (const pageUrl of targets) {
      const url = new URL(pageUrl);
      url.searchParams.set("q", marker);
      const response = await ctx.fetch(url.toString(), { headers: { accept: "text/html" } });
      if (response.body.includes(marker)) reflected.push(response);
    }
    ctx.mark("reflected_xss");
    if (reflected.length > 0) {
      const first = reflected[0];
      ctx.add(
        "reflected_xss",
        "A query parameter was copied into the HTML response without encoding a < character.",
        ctx.detailFor(first, {
          locations: reflected.slice(0, 6).map((response) => ({ method: "GET", url: response.url })),
          steps: reproduce("GET", first.url, "The marker, including a < character, is copied into the HTML.", "Encode untrusted text before inserting it into HTML."),
        }),
        undefined,
        reflected.map((response) => response.url),
      );
    }

    ctx.mark("dom_xss_sink");
    const sinkPattern = /\.innerHTML\s*=|document\.write\s*\(|dangerouslySetInnerHTML|\beval\s*\(/;
    const sink = locateText(ctx.scripts, sinkPattern);
    if (sink) {
      const file = ctx.scripts.find((script) => script.url === sink.url);
      const url = ctx.scriptUrl(sink.url);
      ctx.add(
        "dom_xss_sink",
        "Client code assigns HTML through innerHTML, document.write, dangerouslySetInnerHTML, or eval.",
        ctx.detailFor(
          {
            url,
            status: 200,
            headers: { "content-type": "application/javascript" },
            body: file?.body ?? "",
            setCookies: [],
            location: null,
          },
          {
            locations: [{ method: "GET", url, line: sink.line, column: sink.column }],
            steps: [
              `Open ${url} at line ${sink.line}.`,
              "The code writes HTML or evaluates a string.",
              "Use text APIs, or sanitize markup before inserting it.",
            ],
          },
        ),
        undefined,
        ctx.pagesMatching(sinkPattern),
      );
    }
  });
}

function reflectionTargets(ctx: ScanContext): string[] {
  const targets: string[] = [];
  const add = (url: string) => {
    if (!url.startsWith("http") || targets.includes(url)) return;
    targets.push(url);
  };
  add(ctx.home?.url || ctx.targetUrl);
  for (const page of ctx.pages) {
    if (/<form\b|<input\b/i.test(page.body)) add(page.url);
  }
  return targets;
}
