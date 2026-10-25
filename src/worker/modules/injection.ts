import { reproduce } from "@/lib/finding-detail";
import { locateText } from "../extract";
import { runModule, type ScanContext } from "../context";

export const INJECTION_CHECK_IDS = ["reflected_xss", "dom_xss_sink"] as const;

export async function runInjection(ctx: ScanContext): Promise<void> {
  await runModule([...INJECTION_CHECK_IDS], ctx, async () => {
    const marker = "vcZX777<b>";
    const response = await ctx.fetch(`/?q=${encodeURIComponent(marker)}`);
    ctx.mark("reflected_xss");
    if (response.body.includes(marker)) {
      ctx.add(
        "reflected_xss",
        "A query parameter was copied into the HTML response without encoding a < character.",
        ctx.detailFor(response, {
          steps: reproduce("GET", response.url, "The marker, including a < character, is copied into the HTML.", "Encode untrusted text before inserting it into HTML."),
        }),
      );
    }

    ctx.mark("dom_xss_sink");
    const sink = locateText(ctx.scripts, /\.innerHTML\s*=|document\.write\s*\(|dangerouslySetInnerHTML|\beval\s*\(/);
    if (sink) {
      const file = ctx.scripts.find((script) => script.url === sink.url);
      const url = sink.url.startsWith("inline:") || sink.url.startsWith("rendered:") ? ctx.home?.url || ctx.targetUrl : sink.url;
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
      );
    }
  });
}
