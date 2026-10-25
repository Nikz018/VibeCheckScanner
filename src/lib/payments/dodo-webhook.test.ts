import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, test } from "node:test";
import { Webhook } from "standardwebhooks";
import { monitoringActive } from "../entitlements";

const databaseUrl = process.env.DATABASE_URL;
const webhookSecret = `whsec_${Buffer.from("vibecheck-dodo-webhook-fixture-key").toString("base64")}`;
const skip = databaseUrl ? false : "DATABASE_URL is not set";

process.env.DODO_PAYMENTS_API_KEY = process.env.DODO_PAYMENTS_API_KEY || "dodo_test_local_fixture_not_a_real_key";
process.env.DODO_WEBHOOK_SECRET = webhookSecret;
process.env.DODO_ENV = "test_mode";

test("signed payment unlocks a scan once, a failure does not, and subscription events toggle monitoring", { skip }, async () => {
  const { prisma } = await import("../db");
  const { POST } = await import("../../app/api/dodo/webhook/route");
  const suffix = randomBytes(4).toString("hex");
  const user = await prisma.user.create({ data: { email: `dodo-${suffix}@example.com` } });
  const project = await prisma.project.create({
    data: { userId: user.id, url: "http://127.0.0.1:4010", host: "127.0.0.1:4010", ownershipToken: `vc_${suffix}` },
  });
  const scan = await prisma.scan.create({
    data: { projectId: project.id, userId: user.id, status: "completed", reportAccess: "teaser", targetUrl: project.url },
  });
  await prisma.purchase.create({
    data: { userId: user.id, scanId: scan.id, tier: "report", status: "pending", dodoCheckoutSession: `cks_report_${suffix}` },
  });

  const failed = await post(
    POST,
    event(`msg_fail_${suffix}`, "payment.failed", {
      payment_id: `pay_fail_${suffix}`,
      checkout_session_id: `cks_report_${suffix}`,
      metadata: { userId: user.id, tier: "report", scanId: scan.id },
    }),
  );
  assert.equal(failed.status, 200);
  assert.equal((await prisma.scan.findUniqueOrThrow({ where: { id: scan.id } })).reportAccess, "teaser");
  assert.equal((await prisma.purchase.findFirstOrThrow({ where: { dodoCheckoutSession: `cks_report_${suffix}` } })).status, "failed");

  const unlock = await post(
    POST,
    event(`msg_report_${suffix}`, "payment.succeeded", {
      payment_id: `pay_report_${suffix}`,
      checkout_session_id: `cks_report_${suffix}`,
      metadata: { userId: user.id, tier: "report", scanId: scan.id },
      customer: { customer_id: `cus_${suffix}`, email: user.email, name: "Ada" },
    }),
  );
  assert.equal(unlock.status, 200);
  assert.equal((await prisma.scan.findUniqueOrThrow({ where: { id: scan.id } })).reportAccess, "full");
  assert.equal((await prisma.purchase.findFirstOrThrow({ where: { dodoCheckoutSession: `cks_report_${suffix}` } })).status, "paid");

  const replay = await post(
    POST,
    event(`msg_report_${suffix}`, "payment.succeeded", {
      payment_id: `pay_report_${suffix}`,
      checkout_session_id: `cks_report_${suffix}`,
      metadata: { userId: user.id, tier: "report", scanId: scan.id },
    }),
  );
  assert.equal(replay.status, 200);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).reportCredits, 0);

  const credits = await post(
    POST,
    event(`msg_rescan_${suffix}`, "payment.succeeded", {
      payment_id: `pay_rescan_${suffix}`,
      metadata: { userId: user.id, tier: "rescan", scanId: "" },
    }),
  );
  assert.equal(credits.status, 200);
  const once = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(once.rescanCredits, 1);
  assert.equal(once.reportCredits, 1);
  await post(
    POST,
    event(`msg_rescan_${suffix}`, "payment.succeeded", {
      payment_id: `pay_rescan_${suffix}`,
      metadata: { userId: user.id, tier: "rescan", scanId: "" },
    }),
  );
  const twice = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(twice.rescanCredits, 1);
  assert.equal(twice.reportCredits, 1);

  const periodEnd = "2026-11-25T00:00:00.000Z";
  const active = await post(
    POST,
    event(`msg_active_${suffix}`, "subscription.active", {
      subscription_id: `sub_${suffix}`,
      next_billing_date: periodEnd,
      metadata: { userId: user.id, tier: "monitor", scanId: "" },
      customer: { customer_id: `cus_${suffix}`, email: user.email, name: "Ada" },
    }),
  );
  assert.equal(active.status, 200);
  const started = await prisma.subscription.findUniqueOrThrow({ where: { userId: user.id } });
  assert.equal(started.status, "active");
  assert.equal(started.dodoSubscriptionId, `sub_${suffix}`);
  assert.equal(monitoringActive(started.status), true);

  const renewed = await post(
    POST,
    event(`msg_renewed_${suffix}`, "subscription.renewed", {
      subscription_id: `sub_${suffix}`,
      next_billing_date: "2026-12-25T00:00:00.000Z",
      metadata: { userId: user.id },
    }),
  );
  assert.equal(renewed.status, 200);
  const extended = await prisma.subscription.findUniqueOrThrow({ where: { userId: user.id } });
  assert.equal(extended.status, "active");
  assert.equal(extended.currentPeriodEnd?.toISOString(), "2026-12-25T00:00:00.000Z");

  const cancelled = await post(POST, event(`msg_cancel_${suffix}`, "subscription.cancelled", { subscription_id: `sub_${suffix}`, metadata: { userId: user.id } }));
  assert.equal(cancelled.status, 200);
  const stopped = await prisma.subscription.findUniqueOrThrow({ where: { userId: user.id } });
  assert.equal(stopped.status, "canceled");
  assert.equal(monitoringActive(stopped.status), false);

  const failedSub = await post(POST, event(`msg_subfail_${suffix}`, "subscription.failed", { subscription_id: `sub_${suffix}`, metadata: { userId: user.id } }));
  assert.equal(failedSub.status, 200);
  const dead = await prisma.subscription.findUniqueOrThrow({ where: { userId: user.id } });
  assert.equal(dead.status, "failed");
  assert.equal(monitoringActive(dead.status), false);

  await prisma.user.delete({ where: { id: user.id } });
});

test("webhook rejects a missing or invalid signature before writing", async () => {
  const { POST } = await import("../../app/api/dodo/webhook/route");
  const payload = event(`msg_bad_${randomBytes(4).toString("hex")}`, "payment.succeeded", { payment_id: "pay_bad", metadata: { tier: "report" } });
  const missing = await POST(new Request("http://127.0.0.1/api/dodo/webhook", { method: "POST", body: payload }));
  assert.equal(missing.status, 400);

  const headers = signatureHeaders(payload, "msg_wrong");
  headers.set("webhook-signature", "v1,bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  const invalid = await POST(new Request("http://127.0.0.1/api/dodo/webhook", { method: "POST", body: payload, headers }));
  assert.equal(invalid.status, 400);

  if (!databaseUrl) return;
  const { prisma } = await import("../db");
  assert.equal(await prisma.dodoEvent.count({ where: { id: "msg_wrong" } }), 0);
});

after(async () => {
  if (!databaseUrl) return;
  const { prisma } = await import("../db");
  await prisma.$disconnect();
});

function event(id: string, type: string, data: Record<string, unknown>): string {
  return JSON.stringify({ business_id: "bus_test", type, timestamp: new Date().toISOString(), data, webhookId: id });
}

function signatureHeaders(payload: string, id: string): Headers {
  const timestamp = new Date();
  const signature = new Webhook(webhookSecret).sign(id, timestamp, payload);
  return new Headers({
    "webhook-id": id,
    "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
    "webhook-signature": signature,
    "content-type": "application/json",
  });
}

function post(handler: (request: Request) => Promise<Response>, payload: string): Promise<Response> {
  const parsed = JSON.parse(payload) as { webhookId: string };
  return handler(
    new Request("http://127.0.0.1/api/dodo/webhook", {
      method: "POST",
      body: payload,
      headers: signatureHeaders(payload, parsed.webhookId),
    }),
  );
}
