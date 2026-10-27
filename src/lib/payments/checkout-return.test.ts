import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { CONSENT_TEXT } from "../ownership";
import {
  PAYMENT_CONFIRMING_COPY,
  PAYMENT_DECLINED_COPY,
  PAYMENT_TRY_AGAIN_LABEL,
  checkoutPanel,
  classifyReturnQuery,
  mapIntentStatus,
} from "./checkout-return";
import type { CheckoutStatusReader } from "./confirm-purchase";
import type { PaidFullScanDeps } from "./paid-full-scan";

const databaseUrl = process.env.DATABASE_URL;
const skip = databaseUrl ? false : "DATABASE_URL is not set";

test("a return URL does not count as a paid scan", () => {
  assert.equal(PAYMENT_DECLINED_COPY, "Payment didn't go through. You weren't charged.");
  assert.equal(PAYMENT_CONFIRMING_COPY, "Confirming your payment…");
  assert.equal(PAYMENT_TRY_AGAIN_LABEL, "Try again");
  assert.equal(classifyReturnQuery({ checkout: "success", status: "failed" }), "failed");
  assert.equal(classifyReturnQuery({ checkout: "success", status: "succeeded" }), "returned");
  assert.equal(classifyReturnQuery({ checkout: "cancel" }), "cancelled");
  assert.equal(classifyReturnQuery({ status: "declined" }), "failed");
  assert.equal(mapIntentStatus("succeeded"), "succeeded");
  assert.equal(mapIntentStatus("failed"), "failed");
  assert.equal(mapIntentStatus("processing"), "pending");

  assert.deepEqual(checkoutPanel({ purchaseStatus: "pending", hint: "returned", remote: null, elapsedMs: 0 }), {
    panel: "confirming",
    recheck: false,
  });
  assert.deepEqual(checkoutPanel({ purchaseStatus: "pending", hint: "returned", remote: null, elapsedMs: 15_000 }), {
    panel: "confirming",
    recheck: true,
  });
  assert.equal(checkoutPanel({ purchaseStatus: "paid", hint: "returned", remote: null, elapsedMs: 0 }).panel, "paid");
  assert.equal(checkoutPanel({ purchaseStatus: "pending", hint: "failed", remote: null, elapsedMs: 0 }).panel, "declined");
  assert.equal(checkoutPanel({ purchaseStatus: "pending", hint: "cancelled", remote: null, elapsedMs: 0 }).panel, "declined");
  assert.equal(checkoutPanel({ purchaseStatus: "failed", hint: "absent", remote: null, elapsedMs: 0 }).panel, "declined");
  assert.equal(checkoutPanel({ purchaseStatus: "pending", hint: "returned", remote: "succeeded", elapsedMs: 0 }).panel, "paid");
  assert.equal(checkoutPanel({ purchaseStatus: "pending", hint: "returned", remote: "failed", elapsedMs: 0 }).panel, "declined");
  assert.equal(checkoutPanel({ purchaseStatus: null, hint: "returned", remote: null, elapsedMs: 0 }).panel, "upgrade");
  assert.equal(checkoutPanel({ purchaseStatus: "paid", hint: "failed", remote: null, elapsedMs: 0 }).panel, "paid");

  const page = readFileSync(path.join(process.cwd(), "src/app/scans/[id]/page.tsx"), "utf8");
  const followup = readFileSync(path.join(process.cwd(), "src/components/PaidScanFollowup.tsx"), "utf8");
  const report = readFileSync(path.join(process.cwd(), "src/components/ReportView.tsx"), "utf8");
  assert.equal(page.includes('checkout === "success" &&'), false);
  assert.equal(followup.includes("Payment received"), false);
  assert.match(followup, /PAYMENT_CONFIRMING_COPY/);
  assert.match(report, /PAYMENT_DECLINED_COPY/);
  assert.match(report, /PAYMENT_TRY_AGAIN_LABEL/);
  assert.equal(report.includes("Full scan in progress"), false);
});

test("a declined return is not a paid scan, and a confirmed Dodo status can settle the purchase", { skip }, async () => {
  const { prisma } = await import("../db");
  const { settlePreviewCheckout } = await import("./confirm-purchase");
  const { applyPaymentFailed } = await import("./fulfill");
  const suffix = randomBytes(4).toString("hex");
  const user = await prisma.user.create({ data: { email: `decline-${suffix}@example.com` } });
  const project = await prisma.project.create({
    data: { userId: user.id, url: "http://127.0.0.1:4010", host: "127.0.0.1:4010", ownershipToken: `vc_${suffix}` },
  });
  const scan = await prisma.scan.create({
    data: {
      projectId: project.id,
      userId: user.id,
      status: "completed",
      mode: "mini",
      reportAccess: "full",
      targetUrl: project.url,
      consentAt: new Date(),
      consentText: "preview",
    },
  });
  const purchase = await prisma.purchase.create({
    data: { userId: user.id, scanId: scan.id, tier: "report", status: "pending", dodoCheckoutSession: `cks_decline_${suffix}` },
  });
  let reads = 0;
  const declined: CheckoutStatusReader = async () => {
    reads += 1;
    return { status: "failed", paymentId: `pay_${suffix}`, errorCode: "GENERIC_DECLINE" };
  };
  const waiting = await settlePreviewCheckout({
    purchase,
    query: { checkout: "success" },
    deps: { readStatus: declined },
  });
  assert.equal(waiting.kind, "confirming");
  assert.equal(reads, 0);
  assert.equal((await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } })).status, "pending");

  const failed = await settlePreviewCheckout({
    purchase,
    query: { checkout: "success", status: "failed" },
    deps: { readStatus: declined },
  });
  assert.equal(failed.kind, "declined");
  assert.equal(reads, 1);
  assert.equal((await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } })).status, "failed");
  assert.equal(await prisma.scan.count({ where: { userId: user.id, mode: "full" } }), 0);

  await prisma.purchase.update({ where: { id: purchase.id }, data: { status: "pending" } });
  const enqueued: string[] = [];
  const succeeded: CheckoutStatusReader = async () => ({ status: "succeeded", paymentId: `pay_ok_${suffix}`, errorCode: null });
  const deps: PaidFullScanDeps & { readStatus: CheckoutStatusReader } = {
    readStatus: succeeded,
    verifyOwnership: async () => ({ ok: true, method: "dns_txt" }),
    enqueueScan: async (scanId) => {
      enqueued.push(scanId);
    },
  };
  const paid = await settlePreviewCheckout({
    purchase,
    query: { checkout: "success", recheck: "1" },
    deps,
  });
  assert.equal(paid.kind, "paid");
  assert.equal((await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } })).status, "paid");
  const full = await prisma.scan.findFirstOrThrow({ where: { userId: user.id, mode: "full" } });
  assert.equal(full.consentText, CONSENT_TEXT);
  assert.deepEqual(enqueued, [full.id]);

  await applyPaymentFailed({
    action: "payment_failed",
    id: `late_${suffix}`,
    type: "payment.failed",
    sessionId: `cks_decline_${suffix}`,
    paymentId: `pay_late_${suffix}`,
    errorCode: "GENERIC_DECLINE",
  });
  assert.equal((await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } })).status, "paid");

  await prisma.scanAuthorization.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
});

after(async () => {
  if (!databaseUrl) return;
  const { prisma } = await import("../db");
  await prisma.$disconnect();
});
