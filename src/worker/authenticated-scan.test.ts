import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { buildCustomerReport } from "../lib/report";
import { containsToolBrand } from "../lib/sanitize";
import { LOGIN_FAILED_NOTICE } from "../lib/limitations";
import { runScanPipeline } from "./run-scan";

process.env.ALLOW_LOCAL_TARGETS = "true";
delete process.env.LOCALHOST_REWRITE_HOST;

const origin = "http://127.0.0.1:18013";

async function waitFor(url: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // retry until the demo accepts connections
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${url}`);
}

test("signed-in demo scan finds IDOR, admin, and paywall bugs without leaking secrets", async () => {
  let child: ChildProcess | null = null;
  const previous = process.env.PLAYWRIGHT_ENABLED;
  process.env.PLAYWRIGHT_ENABLED = "false";
  try {
    child = spawn(process.execPath, [path.join(process.cwd(), "demo-targets/logged-in/server.js")], {
      env: { ...process.env, PORT: "18013" },
      stdio: "ignore",
    });
    await waitFor(`${origin}/login`);
    const auth = {
      consent: true as const,
      accounts: [
        {
          label: "A" as const,
          loginUrl: `${origin}/login`,
          username: "alice@example.test",
          password: "test-password-alice",
          cookie: "",
          bearerToken: "",
        },
        {
          label: "B" as const,
          loginUrl: `${origin}/login`,
          username: "bob@example.test",
          password: "test-password-bob",
          cookie: "",
          bearerToken: "",
        },
      ],
    };
    const output = await runScanPipeline({ targetUrl: origin, mode: "full", ownershipConfirmed: true, auth, reportAccess: "full" });
    const ids = new Set(output.results.map((result) => result.checkId));
    for (const id of ["auth_idor_bola", "auth_vertical_privilege", "auth_paywall_bypass", "auth_sensitive_exposure", "auth_session_weakness", "auth_backend_cross_user"]) {
      assert.equal(ids.has(id), true, id);
    }
    const paywall = output.results.find((result) => result.checkId === "auth_paywall_bypass");
    assert.equal(paywall?.confidence, "high");
    const report = buildCustomerReport({
      scanId: "logged-in",
      status: "completed",
      mode: "full",
      access: "full",
      finishedAt: new Date(),
      results: output.results,
      marked: output.marked,
      notices: output.notices,
    });
    const blob = JSON.stringify(report);
    assert.equal(blob.includes("test-password-alice"), false);
    assert.equal(blob.includes("test-password-bob"), false);
    assert.equal(blob.includes("sk_test_authonlydemokey000000000000000"), false);
    assert.equal(blob.includes("embedded-demo-claim"), false);
    assert.equal(/eyJ[A-Za-z0-9_-]{10,}/.test(blob), false);
    assert.equal(/session=[a-f0-9]{16,}/.test(blob), false);
    assert.equal(blob.includes("alice@example.test"), false);
    assert.equal(containsToolBrand(blob), null);
    assert.match(blob, /What this scan does not cover/);
    assert.match(report.limitationsNote, /manual pentest/i);
    assert.ok(report.score !== null && report.score < 100);

    const failed = await runScanPipeline({
      targetUrl: origin,
      mode: "full",
      ownershipConfirmed: true,
      reportAccess: "full",
      auth: {
        consent: true,
        accounts: [{ label: "A", loginUrl: `${origin}/login`, username: "alice@example.test", password: "wrong-password-value", cookie: "", bearerToken: "" }],
      },
    });
    assert.equal(failed.notices.some((notice) => notice.startsWith("Logged-in checks skipped: login failed")), true);
    assert.equal(failed.notices.includes(LOGIN_FAILED_NOTICE), true);
    assert.equal(failed.results.some((result) => result.checkId.startsWith("auth_")), false);
    assert.equal(failed.marked.auth_idor_bola, "skipped");
    assert.ok(failed.marked.missing_csp);
    const failedReport = buildCustomerReport({
      scanId: "login-failed",
      status: "completed",
      mode: "full",
      access: "full",
      finishedAt: new Date(),
      results: failed.results,
      marked: failed.marked,
      notices: failed.notices,
    });
    const quiet = buildCustomerReport({
      scanId: "login-failed-score",
      status: "completed",
      mode: "full",
      access: "full",
      finishedAt: new Date(),
      results: failed.results,
      marked: failed.marked,
      notices: [],
    });
    assert.equal(failedReport.score, quiet.score);
    assert.match(failedReport.notices.join(" "), /Unauthenticated checks still ran/);
  } finally {
    if (previous === undefined) delete process.env.PLAYWRIGHT_ENABLED;
    else process.env.PLAYWRIGHT_ENABLED = previous;
    child?.kill();
  }
});
