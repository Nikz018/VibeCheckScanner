import { matchAdvisories } from "@/lib/advisories";
import { reproduce } from "@/lib/finding-detail";
import { runModule, type ScanContext } from "../context";

export const DEPENDENCY_CHECK_IDS = ["vulnerable_dependency"] as const;

export async function runDependencies(ctx: ScanContext): Promise<void> {
  await runModule([...DEPENDENCY_CHECK_IDS], ctx, async () => {
    ctx.mark("vulnerable_dependency");
    if (!ctx.packageJson) return;
    let dependencies: Record<string, string> = {};
    try {
      const parsed = JSON.parse(ctx.packageJson) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      dependencies = { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) };
    } catch {
      return;
    }
    const hits = matchAdvisories(dependencies);
    if (hits.length === 0) return;
    const detail = hits.map((hit) => `${hit.name}@${hit.version} (${hit.cve}: ${hit.summary})`).join("; ");
    const manifestUrl = new URL("/package.json", ctx.origin).toString();
    ctx.add(
      "vulnerable_dependency",
      `The public manifest lists ${detail}.`,
      ctx.detailFor(
        {
          url: manifestUrl,
          status: 200,
          headers: { "content-type": "application/json" },
          body: ctx.packageJson,
          setCookies: [],
          location: null,
        },
        {
          steps: reproduce("GET", manifestUrl, `The manifest pins ${hits.map((hit) => `${hit.name}@${hit.version}`).join(", ")}.`, "Upgrade past the affected version and stop publishing the manifest."),
        },
      ),
    );
  });
}
