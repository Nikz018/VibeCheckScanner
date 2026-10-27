import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { pricingCheckoutPath, scanCheckoutPath, signInPath, tierFromCheckoutParam } from "./checkout-path";
import { requestCheckout } from "./checkout-request";
import { CHECKOUT_SETUP_MESSAGE, DEFAULT_DODO_PRODUCT_IDS, UPGRADE_ACTIONS } from "./pricing";

test("pricing checkout returns through sign-in to the same plan", () => {
  assert.equal(pricingCheckoutPath("report"), "/pricing?checkout=report");
  assert.equal(signInPath(pricingCheckoutPath("rescan")), "/login?next=%2Fpricing%3Fcheckout%3Drescan");
  assert.equal(signInPath(pricingCheckoutPath("monitor")), "/login?next=%2Fpricing%3Fcheckout%3Dmonitor");
  assert.equal(signInPath("https://evil.example/pricing"), "/login");
  assert.equal(signInPath("//evil.example"), "/login");
  assert.equal(tierFromCheckoutParam("report"), "report");
  assert.equal(tierFromCheckoutParam("nope"), null);
  assert.equal(scanCheckoutPath("scan_1", "report"), "/scans/scan_1?checkout=report#upgrade");
});

test("checkout request shows the setup message when payments are not configured", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "Dodo Payments is not configured. Add DODO_PAYMENTS_API_KEY." }), { status: 503 });
    const unavailable = await requestCheckout({ tier: "report" });
    assert.deepEqual(unavailable, { ok: false, status: 503, error: CHECKOUT_SETUP_MESSAGE });
    assert.equal(CHECKOUT_SETUP_MESSAGE.includes("DODO_"), false);

    globalThis.fetch = async () => new Response(JSON.stringify({ error: "Sign in first." }), { status: 401 });
    const signedOut = await requestCheckout({ tier: "report", scanId: "scan_1" });
    assert.deepEqual(signedOut, { ok: false, status: 401, error: "Sign in first." });

    let body = "";
    globalThis.fetch = async (_input, init) => {
      body = String(init?.body ?? "");
      return new Response(JSON.stringify({ url: "https://checkout.example/session" }), { status: 200 });
    };
    const ready = await requestCheckout({
      tier: "rescan",
      scanId: "scan_1",
      billing: { country: "US", street: "1 Main", city: "Austin", state: "TX", zipcode: "78701" },
    });
    assert.deepEqual(ready, { ok: true, url: "https://checkout.example/session" });
    assert.match(body, /"tier":"rescan"/);
    assert.match(body, /"scanId":"scan_1"/);
    assert.match(body, /"country":"US"/);
  } finally {
    globalThis.fetch = original;
  }
});

test("pricing page and dashboard expose the live checkout actions", () => {
  const root = process.cwd();
  const read = (file: string) => readFileSync(path.join(root, file), "utf8");
  const pricing = read("src/app/pricing/page.tsx");
  const dashboard = read("src/app/dashboard/page.tsx");
  const report = read("src/components/ReportView.tsx");
  assert.match(pricing, /PricingCheckout/);
  assert.match(pricing, /getCurrentUser/);
  assert.match(read("src/components/PricingCheckout.tsx"), /signInPath\(pricingCheckoutPath/);
  assert.match(dashboard, /paidScanDashboardAction/);
  assert.match(dashboard, /scan\.mode === "mini"/);
  assert.match(read("src/lib/payments/paid-scan-status.ts"), /#upgrade/);
  assert.match(report, /FULL_REPORT_PURCHASE_LEDE/);
  assert.equal(UPGRADE_ACTIONS.report, "Upgrade to full report");
  assert.match(report, /FREE_PREVIEW_LABEL/);
  assert.match(report, /freePreviewLines/);
  assert.match(report, /id="upgrade"/);
  assert.match(report, /report\.limitations/);
  assert.equal(DEFAULT_DODO_PRODUCT_IDS.report, "pdt_0NqUPK77rA0fd1CknGv8C");
  assert.equal(DEFAULT_DODO_PRODUCT_IDS.rescan, "pdt_0NqUQCBmdARxCAyoaIRVZ");
  assert.equal(DEFAULT_DODO_PRODUCT_IDS.monitor, "pdt_0NqUQeUgIBSIizoXIrkrJ");
  const example = read(".env.example");
  assert.match(example, new RegExp(`DODO_PRODUCT_REPORT=${DEFAULT_DODO_PRODUCT_IDS.report}`));
  assert.match(example, new RegExp(`DODO_PRODUCT_RESCAN=${DEFAULT_DODO_PRODUCT_IDS.rescan}`));
  assert.match(example, new RegExp(`DODO_PRODUCT_MONITOR=${DEFAULT_DODO_PRODUCT_IDS.monitor}`));
});
