import assert from "node:assert/strict";
import test from "node:test";
import { buildCustomerReport, visibleCustomerFindings } from "../../lib/report";
import { containsToolBrand } from "../../lib/sanitize";
import type { AdvisoryLookup } from "../../lib/osv";
import { ScanContext } from "../context";
import { runDependencies } from "./dependencies";

test("each vulnerable library is its own finding, with the CVE, fix, and detection evidence", async () => {
  const ctx = new ScanContext("https://app.example/", "full", "full");
  ctx.pages = [
    {
      url: "https://app.example/",
      status: 200,
      headers: { "content-type": "text/html" },
      body: `<script src="https://cdn.jsdelivr.net/npm/jquery@3.5.1/dist/jquery.min.js"></script>
<script src="https://esm.sh/vue@3.4.21"></script>`,
      setCookies: [],
      location: null,
    },
  ];
  ctx.packageJson = JSON.stringify({ dependencies: { lodash: "4.17.15" } });
  const queried: string[] = [];
  await runDependencies(ctx, async (packages) => {
    for (const item of packages) queried.push(`${item.name}@${item.version}`);
    const lookedUp: AdvisoryLookup = {
      source: "osv",
      byPackage: new Map([
        ["jquery@3.5.1", [{ id: "CVE-2020-11022", summary: "Cross-site scripting in jQuery", severity: "medium", fixed: "3.6.0" }]],
        ["lodash@4.17.15", [{ id: "CVE-2021-23337", summary: "Prototype pollution in lodash", severity: "high", fixed: "4.17.21" }]],
      ]),
    };
    return lookedUp;
  });

  assert.deepEqual(queried.sort(), ["jquery@3.5.1", "lodash@4.17.15", "vue@3.4.21"]);
  const findings = ctx.results.filter((result) => result.checkId === "vulnerable_dependency");
  assert.equal(findings.length, 2);
  const lodash = findings.find((finding) => finding.title?.includes("lodash"));
  const jquery = findings.find((finding) => finding.title?.includes("jquery"));
  assert.ok(lodash);
  assert.ok(jquery);
  assert.equal(lodash.severity, "high");
  assert.equal(jquery.severity, "medium");
  assert.equal(lodash.confidence, "high");
  assert.match(lodash.evidence, /CVE-2021-23337/);
  assert.match(lodash.evidence, /4\.17\.21/);
  assert.match(lodash.evidence, /public vulnerability database/);
  assert.match(lodash.evidence, /https:\/\/app\.example\/package\.json/);
  assert.match(lodash.evidence, /lodash@4\.17\.15|lodash": "4\.17\.15/);
  assert.match(lodash.fix ?? "", /npm install lodash@4\.17\.21/);
  assert.match(jquery.evidence, /CVE-2020-11022/);
  assert.match(jquery.evidence, /jquery@3\.5\.1/);
  assert.match(jquery.evidence, /cdn\.jsdelivr\.net/);
  assert.equal(jquery.advisories?.[0]?.id, "CVE-2020-11022");
  assert.ok(jquery.locations && jquery.locations.length > 0);
  assert.ok(jquery.proof && jquery.proof.responseSnippet.length > 0 && jquery.proof.responseSnippet.length <= 300);
  assert.ok(jquery.steps && jquery.steps.length >= 1 && jquery.steps.length <= 3);
  assert.equal(ctx.marked.vulnerable_dependency, "ok");

  const blob = JSON.stringify(ctx.results);
  assert.doesNotMatch(blob, /\bOSV\b|osv\.dev|Wappalyzer/i);
  assert.equal(containsToolBrand(blob), null);

  const marked = { vulnerable_dependency: "ok" as const, client_backend_config: "ok" as const };
  const paid = buildCustomerReport({
    scanId: "deps",
    status: "completed",
    mode: "full",
    access: "full",
    finishedAt: new Date("2026-10-30T00:00:00.000Z"),
    marked,
    results: ctx.results,
  });
  assert.equal(visibleCustomerFindings(paid).filter((finding) => finding.checkId === "vulnerable_dependency").length, 2);
  assert.equal(containsToolBrand(JSON.stringify(paid)), null);

  const teaser = buildCustomerReport({
    scanId: "deps-free",
    status: "completed",
    mode: "full",
    access: "teaser",
    finishedAt: new Date("2026-10-30T00:00:00.000Z"),
    marked,
    results: [...ctx.results, { checkId: "client_backend_config", evidence: "INFO_ONLY" }],
  });
  assert.equal(teaser.samples[0]?.checkId, "client_backend_config");
  assert.equal(teaser.samples.length, 1);
  const hidden = JSON.stringify(teaser);
  assert.equal(hidden.includes("CVE-2021-23337"), false);
  assert.equal(hidden.includes("CVE-2020-11022"), false);
  assert.equal(hidden.includes("cdn.jsdelivr.net"), false);
  assert.equal(hidden.includes("INFO_ONLY"), true);
});
