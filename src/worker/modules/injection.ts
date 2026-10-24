import { runModule, type ScanContext } from "../context";

export const INJECTION_CHECK_IDS = ["reflected_xss", "dom_xss_sink"] as const;

export async function runInjection(ctx: ScanContext): Promise<void> {
  await runModule([...INJECTION_CHECK_IDS], ctx, async () => {
    const marker = "vcZX777<b>";
    const response = await ctx.fetch(`/?q=${encodeURIComponent(marker)}`);
    ctx.mark("reflected_xss");
    if (response.body.includes(marker)) {
      ctx.add("reflected_xss", "The q query parameter was copied into the HTML response without encoding a < character.");
    }

    ctx.mark("dom_xss_sink");
    const sink = ctx.scripts.find((script) => /\.innerHTML\s*=|document\.write\s*\(|dangerouslySetInnerHTML|\beval\s*\(/.test(script.body));
    if (sink) {
      ctx.add("dom_xss_sink", `Client code in ${sink.url} assigns HTML through innerHTML, document.write, dangerouslySetInnerHTML, or eval.`);
    }
  });
}
