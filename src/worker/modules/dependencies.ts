import { renderDependencyFinding, type VulnerableVersion } from "@/lib/dependency-finding";
import { fingerprintDependencies, type VersionEvidence } from "@/lib/fingerprint";
import { reproduce } from "@/lib/finding-detail";
import { lookupAdvisories, packageAdvisoryKey, type AdvisoryLookupFn, type PackageVersion } from "@/lib/osv";
import type { ProbeResponse } from "@/lib/http";
import { runModule, type ScanContext } from "../context";

export const DEPENDENCY_CHECK_IDS = ["vulnerable_dependency"] as const;
const MAX_PACKAGES = 40;

export async function runDependencies(ctx: ScanContext, lookup: AdvisoryLookupFn = lookupAdvisories): Promise<void> {
  await runModule([...DEPENDENCY_CHECK_IDS], ctx, async () => {
    ctx.mark("vulnerable_dependency");
    const pages = ctx.pages.map((page) => ({ url: page.url, headers: page.headers, body: page.body }));
    if (ctx.home && !pages.some((page) => page.url === ctx.home?.url)) {
      pages.unshift({ url: ctx.home.url, headers: ctx.home.headers, body: ctx.home.body });
    }
    const detected = fingerprintDependencies({
      pages,
      scripts: ctx.scripts.map((script) => ({ url: script.url, body: script.body, pageUrls: script.pageUrls })),
      packageJson: ctx.packageJson,
      packageJsonUrl: ctx.packageJson ? new URL("/package.json", ctx.origin).toString() : null,
    }).slice(0, MAX_PACKAGES);
    if (detected.length === 0) return;

    const queried: PackageVersion[] = detected.map((item) => ({ name: item.name, version: item.version }));
    const lookedUp = await lookup(queried);
    const groups = new Map<string, VulnerableVersion[]>();
    for (const item of detected) {
      const advisories = lookedUp.byPackage.get(packageAdvisoryKey(item.name, item.version)) ?? [];
      if (advisories.length === 0) continue;
      const versions = groups.get(item.name) ?? [];
      versions.push({
        version: item.version,
        confidence: item.confidence,
        evidence: item.evidence,
        advisories,
      });
      groups.set(item.name, versions);
    }

    for (const [name, versions] of [...groups.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
      const rendered = renderDependencyFinding(name, versions);
      if (!rendered) continue;
      const url = rendered.urls[0] ?? rendered.primary.url;
      ctx.add(
        "vulnerable_dependency",
        rendered.evidence,
        ctx.detailFor(observedResponse(ctx, rendered.primary), {
          locations: rendered.urls.map((location) => ({ method: "GET", url: location })),
          steps: reproduce("GET", url, rendered.saw, rendered.next),
          snippetLines: rendered.primary.source === "package_json" ? [] : [rendered.primary.snippet],
        }),
        rendered.confidence,
        rendered.pages,
        {
          separate: true,
          severity: rendered.severity,
          title: rendered.title,
          impact: rendered.impact,
          fix: rendered.fix,
          advisories: rendered.advisories,
        },
      );
    }
  });
}

function observedResponse(ctx: ScanContext, evidence: VersionEvidence): ProbeResponse {
  if (evidence.source === "package_json" && ctx.packageJson) {
    return {
      url: evidence.url,
      status: 200,
      headers: { "content-type": "application/json" },
      body: ctx.packageJson,
      setCookies: [],
      location: null,
    };
  }
  const page = ctx.pages.find((item) => item.url === evidence.pageUrl) ?? ctx.pages.find((item) => item.url === evidence.url) ?? ctx.home;
  if (page) return { ...page, body: evidence.snippet };
  return {
    url: evidence.url,
    status: 200,
    headers: {},
    body: evidence.snippet,
    setCookies: [],
    location: null,
  };
}
