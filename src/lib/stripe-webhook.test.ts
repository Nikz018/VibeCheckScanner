import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, test } from "node:test";
import Stripe from "stripe";

const databaseUrl = process.env.DATABASE_URL;
const secretKey = process.env.STRIPE_SECRET_KEY || "sk_test_local_fixture_not_a_real_key";
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "whsec_local_fixture_not_from_stripe";
const skip = databaseUrl ? false : "DATABASE_URL is not set; webhook unlock is covered by scripts/e2e-local.sh";

process.env.STRIPE_SECRET_KEY = secretKey;
process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;

test("signed checkout unlocks a scan and a duplicate event does not apply twice", { skip }, async () => {
  const { prisma } = await import("./db");
  const { POST } = await import("../app/api/stripe/webhook/route");
  const stripe = new Stripe(secretKey);
  const suffix = randomBytes(4).toString("hex");
  const user = await prisma.user.create({ data: { email: `webhook-${suffix}@example.com` } });
  const project = await prisma.project.create({
    data: { userId: user.id, url: "http://127.0.0.1:4010", host: "127.0.0.1:4010", ownershipToken: `vc_${suffix}` },
  });
  const scan = await prisma.scan.create({
    data: {
      projectId: project.id,
      userId: user.id,
      status: "completed",
      reportAccess: "teaser",
      targetUrl: project.url,
    },
  });

  const unlock = await postEvent(POST, stripe, checkoutEvent(`evt_report_${suffix}`, user.id, "report", scan.id, `cs_report_${suffix}`));
  assert.equal(unlock.status, 200);
  const unlocked = await prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
  assert.equal(unlocked.reportAccess, "full");

  const replay = await postEvent(POST, stripe, checkoutEvent(`evt_report_${suffix}`, user.id, "report", scan.id, `cs_report_${suffix}`));
  assert.equal(replay.status, 200);
  assert.equal((await prisma.scan.findUniqueOrThrow({ where: { id: scan.id } })).reportAccess, "full");

  const credits = await postEvent(POST, stripe, checkoutEvent(`evt_rescan_${suffix}`, user.id, "rescan", "", `cs_rescan_${suffix}`));
  assert.equal(credits.status, 200);
  const once = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(once.rescanCredits, 1);
  assert.equal(once.reportCredits, 1);
  const creditsAgain = await postEvent(POST, stripe, checkoutEvent(`evt_rescan_${suffix}`, user.id, "rescan", "", `cs_rescan_${suffix}`));
  assert.equal(creditsAgain.status, 200);
  const twice = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(twice.rescanCredits, 1);
  assert.equal(twice.reportCredits, 1);

  const periodEnd = 1893456000;
  const subscription = await postEvent(
    POST,
    stripe,
    JSON.stringify({
      id: `evt_sub_${suffix}`,
      object: "event",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: `sub_${suffix}`,
          object: "subscription",
          status: "active",
          customer: `cus_${suffix}`,
          metadata: { userId: user.id },
          current_period_end: periodEnd,
        },
      },
    }),
  );
  assert.equal(subscription.status, 200);
  const row = await prisma.subscription.findUniqueOrThrow({ where: { userId: user.id } });
  assert.equal(row.status, "active");
  assert.equal(row.stripeSubscriptionId, `sub_${suffix}`);
  assert.equal(row.currentPeriodEnd?.toISOString(), new Date(periodEnd * 1000).toISOString());

  await prisma.user.delete({ where: { id: user.id } });
});

test("webhook rejects a missing or invalid signature before writing", { skip }, async () => {
  const { prisma } = await import("./db");
  const { POST } = await import("../app/api/stripe/webhook/route");
  const stripe = new Stripe(secretKey);
  const payload = JSON.stringify({
    id: `evt_bad_${randomBytes(4).toString("hex")}`,
    object: "event",
    type: "checkout.session.completed",
    data: { object: { id: "cs_bad", object: "checkout.session" } },
  });

  const missing = await POST(new Request("http://127.0.0.1/api/stripe/webhook", { method: "POST", body: payload }));
  assert.equal(missing.status, 400);

  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_wrong_secret" });
  const invalid = await POST(
    new Request("http://127.0.0.1/api/stripe/webhook", {
      method: "POST",
      body: payload,
      headers: { "stripe-signature": header, "content-type": "application/json" },
    }),
  );
  assert.equal(invalid.status, 400);
  assert.equal(await prisma.stripeEvent.count({ where: { id: JSON.parse(payload).id } }), 0);
});

after(async () => {
  if (!databaseUrl) return;
  const { prisma } = await import("./db");
  await prisma.$disconnect();
});

function checkoutEvent(id: string, userId: string, tier: string, scanId: string, sessionId: string): string {
  return JSON.stringify({
    id,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        mode: "payment",
        payment_status: "paid",
        payment_intent: `pi_${id}`,
        metadata: { userId, tier, scanId },
      },
    },
  });
}

async function postEvent(
  post: (request: Request) => Promise<Response>,
  stripe: Stripe,
  payload: string,
): Promise<Response> {
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
  return post(
    new Request("http://127.0.0.1/api/stripe/webhook", {
      method: "POST",
      body: payload,
      headers: { "stripe-signature": signature, "content-type": "application/json" },
    }),
  );
}
