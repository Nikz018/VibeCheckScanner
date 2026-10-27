import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { getCheck, type Severity } from "../lib/catalog";
import { buildCoverage, buildCustomerReport, type RawCheckResult } from "../lib/report";
import { containsToolBrand } from "../lib/sanitize";
import { newOwnershipToken, verifyOwnership } from "../lib/ownership";
import { runScanPipeline } from "./run-scan";

process.env.ALLOW_LOCAL_TARGETS = "true";
process.env.PLAYWRIGHT_ENABLED = "false";
delete process.env.LOCALHOST_REWRITE_HOST;

const targets = [
  { name: "open-backend", script: "demo-targets/open-backend/server.js", port: 18010 },
  { name: "paywall", script: "demo-targets/paywall/server.js", port: 18011 },
  { name: "leaky-basics", script: "demo-targets/leaky-basics/server.js", port: 18012 },
];

async function waitFor(url: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // retry until the demo process accepts connections
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${url}`);
}

function assertFindingsLocated(results: RawCheckResult[]): void {
  for (const result of results) {
    assert.ok(result.locations && result.locations.length > 0, `${result.checkId} location`);
    assert.ok(result.proof, `${result.checkId} proof`);
    assert.ok(result.steps && result.steps.length >= 1 && result.steps.length <= 3, `${result.checkId} steps`);
    assert.ok(result.proof.responseSnippet.length > 0 && result.proof.responseSnippet.length <= 300, `${result.checkId} snippet`);
    assert.equal(result.locations.every((location) => location.method && location.url.startsWith("http")), true, result.checkId);
  }
}

test("active scanning refuses to start without ownership confirmation", async () => {
  await assert.rejects(
    () => runScanPipeline({ targetUrl: "http://127.0.0.1:9/", mode: "full", ownershipConfirmed: false }),
    /Ownership proof and consent are required/,
  );
});

test("demo targets produce multi-section reports with no tool brands", async () => {
  const children: ChildProcess[] = [];
  try {
    for (const target of targets) {
      const child = spawn(process.execPath, [path.join(process.cwd(), target.script)], {
        env: { ...process.env, PORT: String(target.port) },
        stdio: "ignore",
      });
      children.push(child);
      await waitFor(`http://127.0.0.1:${target.port}/`);
    }

    const openOrigin = "http://127.0.0.1:18010";
    const token = newOwnershipToken();
    const before = await verifyOwnership(openOrigin, token);
    assert.equal(before.ok, false);
    const installed = await fetch(`${openOrigin}/_demo/install-proof`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    assert.equal(installed.status, 200);
    const after = await verifyOwnership(openOrigin, token);
    assert.equal(after.ok, true);
    assert.equal(after.method, "well_known");

    const open = await runScanPipeline({ targetUrl: openOrigin, mode: "full", ownershipConfirmed: true });
    const openIds = new Set(open.results.map((result) => result.checkId));
    for (const id of ["supabase_rls_disabled", "firebase_rules_open", "secret_in_client", "public_storage_bucket", "directory_listing"]) {
      assert.equal(openIds.has(id), true, id);
    }
    const openCoverage = buildCoverage(open.marked, [...openIds]);
    for (const row of openCoverage) {
      assert.equal(row.checksNotRun.length, 0, row.family);
      assert.notEqual(row.status, "not_run", row.family);
    }
    const openReport = buildCustomerReport({
      scanId: "open",
      status: "completed",
      mode: "full",
      access: "full",
      finishedAt: new Date(),
      results: open.results,
      marked: open.marked,
    });
    assert.equal(openReport.coverage.length, 8);
    assert.ok((openReport.score ?? 0) < 100);
    assert.equal(containsToolBrand(JSON.stringify(openReport)), null);
    for (const result of open.results) {
      assert.ok(result.locations && result.locations.length > 0, `${result.checkId} location`);
      assert.ok(result.proof, `${result.checkId} proof`);
      assert.ok(result.steps && result.steps.length >= 1 && result.steps.length <= 3, `${result.checkId} steps`);
      assert.ok(result.proof.responseSnippet.length > 0 && result.proof.responseSnippet.length <= 300, `${result.checkId} snippet`);
      assert.equal(result.locations.every((location) => location.method && location.url.startsWith("http")), true, result.checkId);
    }
    const leaked = open.results.find((result) => result.checkId === "secret_in_client");
    assert.ok(leaked?.locations?.some((location) => location.url.includes("/assets/app.js")));
    assert.ok(leaked?.locations?.some((location) => (location.line ?? 0) > 0 && (location.column ?? 0) > 0));
    assert.match(leaked?.locations?.find((location) => location.maskedSecret)?.maskedSecret ?? "", /^.{4}….+$/);
    const firebase = open.results.find((result) => result.checkId === "firebase_rules_open");
    assert.match(firebase?.locations?.[0].url ?? "", /\/rtdb\/\.json$/);
    const paidBlob = JSON.stringify(openReport);
    assert.equal(paidBlob.includes("sk_test_demo_not_real_000000000000000"), false);
    assert.equal(paidBlob.includes("ada@example.com"), false);
    assert.equal(/eyJ[A-Za-z0-9_-]{20,}/.test(paidBlob), false);
    const teaser = buildCustomerReport({
      scanId: "open-teaser",
      status: "completed",
      mode: "full",
      access: "teaser",
      finishedAt: new Date(),
      results: open.results,
      marked: open.marked,
    });
    const teaserBlob = JSON.stringify(teaser);
    const severityRank: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    let lowest: Severity = "critical";
    for (const result of open.results) {
      const severity = result.severity ?? getCheck(result.checkId).severity;
      if (severityRank[severity] > severityRank[lowest]) lowest = severity;
    }
    assert.equal(teaser.access, "teaser");
    assert.equal(teaser.samples.length, 1);
    assert.equal(teaser.samples[0]?.severity, lowest);
    assert.equal(teaser.families.length, 0);
    assert.equal(teaser.priority.length, 0);
    assert.equal(teaser.hiddenCount, open.results.length - 1);
    assert.equal(teaser.totalFindings, open.results.length);
    const shownBlob = JSON.stringify(teaser.samples[0]);
    for (const needle of ["/assets/app.js", "/rtdb/.json", "/rest/v1/", "sk_test_demo_not_real"]) {
      if (!shownBlob.includes(needle)) assert.equal(teaserBlob.includes(needle), false, needle);
    }
    for (const result of open.results) {
      if (result.checkId === teaser.samples[0]?.checkId) continue;
      assert.equal(teaserBlob.includes(result.evidence), false, result.checkId);
    }

    const paywall = await runScanPipeline({ targetUrl: "http://127.0.0.1:18011", mode: "full", ownershipConfirmed: true });
    assertFindingsLocated(paywall.results);
    const paywallIds = new Set(paywall.results.map((result) => result.checkId));
    for (const id of [
      "admin_surface_open",
      "idor_sequential_ids",
      "client_side_paywall",
      "stripe_webhook_unsigned",
      "llm_endpoint_open",
      "llm_prompt_leak",
      "llm_missing_rate_limit",
      "signup_privileged_role",
      "login_missing_rate_limit",
      "open_redirect",
    ]) {
      assert.equal(paywallIds.has(id), true, id);
    }

    const leaky = await runScanPipeline({ targetUrl: "http://127.0.0.1:18012", mode: "full", ownershipConfirmed: true });
    assertFindingsLocated(leaky.results);
    const dotenv = leaky.results.find((result) => result.checkId === "exposed_dotenv");
    assert.match(dotenv?.locations?.[0].url ?? "", /\/\.env$/);
    const header = leaky.results.find((result) => result.checkId === "missing_csp");
    assert.match(header?.locations?.[0].url ?? "", /^http:\/\/127\.0\.0\.1:18012\/?$/);
    const leakyIds = new Set(leaky.results.map((result) => result.checkId));
    for (const id of [
      "missing_csp",
      "cors_credential_wildcard",
      "insecure_cookies",
      "exposed_dotenv",
      "secret_in_public_path",
      "exposed_git",
      "exposed_sourcemap",
      "exposed_debug_route",
      "verbose_errors",
      "reflected_xss",
      "dom_xss_sink",
      "vulnerable_dependency",
      "exposed_package_manifest",
    ]) {
      assert.equal(leakyIds.has(id), true, id);
    }
    const leakyReport = buildCustomerReport({
      scanId: "leaky",
      status: "completed",
      mode: "full",
      access: "full",
      finishedAt: new Date(),
      results: leaky.results,
      marked: leaky.marked,
    });
    assert.equal(containsToolBrand(JSON.stringify(leakyReport)), null);
    assert.ok(leakyReport.families.length >= 4);

    const mini = await runScanPipeline({ targetUrl: "http://127.0.0.1:18012", mode: "mini", ownershipConfirmed: true });
    const miniCoverage = buildCoverage(
      mini.marked,
      mini.results.map((result) => result.checkId),
    );
    assert.equal(miniCoverage.find((row) => row.family === "access_control")?.status, "not_run");
    assert.equal(miniCoverage.find((row) => row.family === "dependencies")?.status, "not_run");
    assert.notEqual(miniCoverage.find((row) => row.family === "transport_headers")?.status, "not_run");
    assert.equal(mini.results.some((result) => result.checkId === "supabase_rls_disabled"), false);
    assert.equal(mini.results.some((result) => result.checkId === "exposed_dotenv"), true);
    const secrets = miniCoverage.find((row) => row.family === "secrets");
    assert.ok(secrets?.checksRun.includes("secret_in_public_path"));
    assert.ok(secrets?.checksNotRun.includes("secret_in_client"));
  } finally {
    for (const child of children) child.kill();
  }
});
