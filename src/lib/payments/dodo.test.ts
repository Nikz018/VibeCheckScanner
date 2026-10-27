import assert from "node:assert/strict";
import { test } from "node:test";
import type { CheckoutSessionCreateParams } from "dodopayments/resources/checkout-sessions";
import { CHECKOUT_SETUP_MESSAGE, DEFAULT_DODO_PRODUCT_IDS } from "../pricing";
import { dodoEnvironment, dodoPaymentProvider, dodoProductId, normalizeDodoEvent, parseBilling } from "./dodo";
import { InvalidSignatureError, MissingSignatureError, PaymentNotConfiguredError, PaymentRequestError } from "./errors";
import { paymentProviderId, prepareCheckout, subscriptionCancelTarget } from "./index";
import { Webhook } from "standardwebhooks";

const webhookSecret = `whsec_${Buffer.from("vibecheck-dodo-webhook-fixture-key").toString("base64")}`;

test("PAYMENT_PROVIDER defaults to dodo and cancel prefers the active provider", () => {
  const previous = process.env.PAYMENT_PROVIDER;
  delete process.env.PAYMENT_PROVIDER;
  assert.equal(paymentProviderId(), "dodo");
  process.env.PAYMENT_PROVIDER = "stripe";
  assert.equal(paymentProviderId(), "stripe");
  process.env.PAYMENT_PROVIDER = "nope";
  assert.equal(paymentProviderId(), null);
  if (previous === undefined) delete process.env.PAYMENT_PROVIDER;
  else process.env.PAYMENT_PROVIDER = previous;

  const row = { dodoSubscriptionId: "sub_dodo", stripeSubscriptionId: "sub_stripe" };
  assert.deepEqual(subscriptionCancelTarget(row, "dodo"), { provider: "dodo", subscriptionId: "sub_dodo" });
  assert.deepEqual(subscriptionCancelTarget(row, "stripe"), { provider: "stripe", subscriptionId: "sub_stripe" });
  assert.deepEqual(subscriptionCancelTarget({ dodoSubscriptionId: null, stripeSubscriptionId: "sub_stripe" }, "dodo"), {
    provider: "stripe",
    subscriptionId: "sub_stripe",
  });
  assert.equal(subscriptionCancelTarget({ dodoSubscriptionId: null, stripeSubscriptionId: null }, "dodo"), null);
});

test("DODO_ENV defaults to test mode", () => {
  const previous = process.env.DODO_ENV;
  delete process.env.DODO_ENV;
  assert.equal(dodoEnvironment(), "test_mode");
  process.env.DODO_ENV = "live_mode";
  assert.equal(dodoEnvironment(), "live_mode");
  process.env.DODO_ENV = "test_mode";
  assert.equal(dodoEnvironment(), "test_mode");
  if (previous === undefined) delete process.env.DODO_ENV;
  else process.env.DODO_ENV = previous;
});

test("billing address requires a country code and a full address", () => {
  assert.throws(() => parseBilling(undefined), PaymentRequestError);
  assert.throws(() => parseBilling({ country: "USA", street: "1 Main", city: "Austin", state: "TX", zipcode: "78701" }), PaymentRequestError);
  assert.deepEqual(parseBilling({ country: "us", street: " 1 Main ", city: "Austin", state: "TX", zipcode: "78701", name: "Ada" }), {
    country: "US",
    street: "1 Main",
    city: "Austin",
    state: "TX",
    zipcode: "78701",
    name: "Ada",
  });
});

test("checkout session sends the product, metadata, and billing address", async () => {
  const previous = process.env.DODO_PRODUCT_REPORT;
  process.env.DODO_PRODUCT_REPORT = "pdt_report";
  let body: CheckoutSessionCreateParams | null = null;
  const provider = dodoPaymentProvider({
    checkoutSessions: {
      create: async (input) => {
        body = input;
        return { session_id: "cks_test", checkout_url: "https://test.checkout.dodopayments.com/session/cks_test" };
      },
    },
    subscriptions: { update: async () => ({}) },
    webhooks: { unwrap: () => ({}) },
  });
  const session = await provider.createCheckout({
    userId: "user_1",
    email: "ada@example.com",
    tier: "report",
    scanId: "scan_1",
    successUrl: "https://app.example/scans/scan_1?checkout=success",
    cancelUrl: "https://app.example/scans/scan_1?checkout=cancel",
    billing: { country: "US", street: "1 Main", city: "Austin", state: "TX", zipcode: "78701", name: "Ada" },
  });
  assert.equal(session.url, "https://test.checkout.dodopayments.com/session/cks_test");
  assert.equal(session.sessionId, "cks_test");
  assert.ok(body);
  const sent = body as CheckoutSessionCreateParams;
  assert.deepEqual(sent.product_cart, [{ product_id: "pdt_report", quantity: 1 }]);
  assert.deepEqual(sent.metadata, { userId: "user_1", scanId: "scan_1", tier: "report" });
  assert.deepEqual(sent.billing_address, { country: "US", street: "1 Main", city: "Austin", state: "TX", zipcode: "78701" });
  assert.equal(sent.return_url, "https://app.example/scans/scan_1?checkout=success");
  assert.equal(sent.cancel_url, "https://app.example/scans/scan_1?checkout=cancel");
  assert.equal(sent.minimal_address, false);
  if (previous === undefined) delete process.env.DODO_PRODUCT_REPORT;
  else process.env.DODO_PRODUCT_REPORT = previous;
});

test("unset product env uses the live default, and checkout still requires a billing address", async () => {
  const previous = process.env.DODO_PRODUCT_MONITOR;
  delete process.env.DODO_PRODUCT_MONITOR;
  assert.equal(dodoProductId("monitor"), DEFAULT_DODO_PRODUCT_IDS.monitor);
  let productId = "";
  const provider = dodoPaymentProvider({
    checkoutSessions: {
      create: async (input) => {
        productId = input.product_cart[0]?.product_id ?? "";
        return { session_id: "cks", checkout_url: "https://example.com/checkout" };
      },
    },
    subscriptions: { update: async () => ({}) },
    webhooks: { unwrap: () => ({}) },
  });
  const session = await provider.createCheckout({
    userId: "user_1",
    email: "ada@example.com",
    tier: "monitor",
    scanId: "",
    successUrl: "https://app.example/ok",
    cancelUrl: "https://app.example/cancel",
    billing: { country: "US", street: "1 Main", city: "Austin", state: "TX", zipcode: "78701" },
  });
  assert.equal(session.url, "https://example.com/checkout");
  assert.equal(productId, "pdt_0NqUQeUgIBSIizoXIrkrJ");
  process.env.DODO_PRODUCT_MONITOR = "  ";
  assert.equal(dodoProductId("monitor"), DEFAULT_DODO_PRODUCT_IDS.monitor);
  process.env.DODO_PRODUCT_MONITOR = "pdt_monitor";
  assert.equal(dodoProductId("monitor"), "pdt_monitor");
  await assert.rejects(
    () =>
      provider.createCheckout({
        userId: "user_1",
        email: "ada@example.com",
        tier: "monitor",
        scanId: "",
        successUrl: "https://app.example/ok",
        cancelUrl: "https://app.example/cancel",
      }),
    PaymentRequestError,
  );
  if (previous === undefined) delete process.env.DODO_PRODUCT_MONITOR;
  else process.env.DODO_PRODUCT_MONITOR = previous;
});

test("missing API key is reported before billing validation", () => {
  const previous = process.env.DODO_PAYMENTS_API_KEY;
  delete process.env.DODO_PAYMENTS_API_KEY;
  try {
    const provider = dodoPaymentProvider();
    assert.equal(provider.checkoutConfigured(), false);
    assert.throws(
      () => prepareCheckout(provider, undefined),
      (error: unknown) => {
        assert.ok(error instanceof PaymentNotConfiguredError);
        assert.equal((error as Error).message, CHECKOUT_SETUP_MESSAGE);
        return true;
      },
    );
    process.env.DODO_PAYMENTS_API_KEY = "dodo_test_not_a_real_key";
    const ready = dodoPaymentProvider();
    assert.equal(ready.checkoutConfigured(), true);
    assert.throws(() => prepareCheckout(ready, undefined), PaymentRequestError);
  } finally {
    if (previous === undefined) delete process.env.DODO_PAYMENTS_API_KEY;
    else process.env.DODO_PAYMENTS_API_KEY = previous;
  }
});

test("checkout without an API key tells the visitor to try again soon", async () => {
  const previous = process.env.DODO_PAYMENTS_API_KEY;
  delete process.env.DODO_PAYMENTS_API_KEY;
  try {
    const provider = dodoPaymentProvider();
    await assert.rejects(
      () =>
        provider.createCheckout({
          userId: "user_1",
          email: "ada@example.com",
          tier: "report",
          scanId: "scan_1",
          successUrl: "https://app.example/ok",
          cancelUrl: "https://app.example/cancel",
          billing: { country: "US", street: "1 Main", city: "Austin", state: "TX", zipcode: "78701" },
        }),
      (error: unknown) => {
        assert.ok(error instanceof PaymentNotConfiguredError);
        assert.equal((error as Error).message, CHECKOUT_SETUP_MESSAGE);
        assert.equal((error as Error).message.includes("DODO_"), false);
        return true;
      },
    );
  } finally {
    if (previous === undefined) delete process.env.DODO_PAYMENTS_API_KEY;
    else process.env.DODO_PAYMENTS_API_KEY = previous;
  }
});

test("cancel marks the Dodo subscription cancelled", async () => {
  let called: { id: string; body: { status?: "cancelled" } } | null = null;
  const provider = dodoPaymentProvider({
    checkoutSessions: { create: async () => ({ session_id: "cks", checkout_url: "https://example.com" }) },
    subscriptions: {
      update: async (id, body) => {
        called = { id, body };
        return {};
      },
    },
    webhooks: { unwrap: () => ({}) },
  });
  await provider.cancelSubscription("sub_123");
  assert.deepEqual(called, { id: "sub_123", body: { status: "cancelled" } });
});

test("webhook verification accepts a Standard Webhooks signature and rejects a bad one", () => {
  process.env.DODO_PAYMENTS_API_KEY = "dodo_test_local_fixture_not_a_real_key";
  process.env.DODO_WEBHOOK_SECRET = webhookSecret;
  process.env.DODO_ENV = "test_mode";
  const provider = dodoPaymentProvider();
  const payload = JSON.stringify({
    business_id: "bus_test",
    type: "payment.succeeded",
    timestamp: new Date().toISOString(),
    data: {
      payment_id: "pay_1",
      checkout_session_id: "cks_1",
      subscription_id: null,
      metadata: { userId: "user_1", tier: "report", scanId: "scan_1" },
      customer: { customer_id: "cus_1", email: "ada@example.com", name: "Ada" },
    },
  });
  const signed = sign(payload, "msg_ok");
  const event = provider.parseWebhook(payload, signed.headers);
  assert.equal(event.action, "payment_succeeded");
  if (event.action === "payment_succeeded") {
    assert.equal(event.id, "msg_ok");
    assert.equal(event.userId, "user_1");
    assert.equal(event.tier, "report");
    assert.equal(event.scanId, "scan_1");
    assert.equal(event.sessionId, "cks_1");
    assert.equal(event.paymentId, "pay_1");
  }
  assert.throws(() => provider.parseWebhook(payload, new Headers()), MissingSignatureError);
  const wrong = sign(payload, "msg_bad");
  wrong.headers.set("webhook-signature", "v1,aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.throws(() => provider.parseWebhook(payload, wrong.headers), InvalidSignatureError);
});

test("normalized events map unlocks and monitoring", () => {
  const paid = normalizeDodoEvent("msg_paid", {
    type: "payment.failed",
    data: { payment_id: "pay_f", checkout_session_id: "cks_f", metadata: { userId: "user_1", tier: "report", scanId: "scan_1" } },
  });
  assert.equal(paid.action, "payment_failed");
  const active = normalizeDodoEvent("msg_active", {
    type: "subscription.active",
    data: {
      subscription_id: "sub_1",
      next_billing_date: "2026-11-25T00:00:00.000Z",
      metadata: { userId: "user_1" },
      customer: { customer_id: "cus_1", email: "ada@example.com" },
    },
  });
  assert.equal(active.action, "subscription");
  if (active.action === "subscription") {
    assert.equal(active.status, "active");
    assert.equal(active.currentPeriodEnd?.toISOString(), "2026-11-25T00:00:00.000Z");
  }
  const renewed = normalizeDodoEvent("msg_renewed", { type: "subscription.renewed", data: { subscription_id: "sub_1" } });
  assert.equal(renewed.action === "subscription" && renewed.status, "active");
  const cancelled = normalizeDodoEvent("msg_cancel", { type: "subscription.cancelled", data: { subscription_id: "sub_1" } });
  assert.equal(cancelled.action === "subscription" && cancelled.status, "canceled");
  const failed = normalizeDodoEvent("msg_fail", { type: "subscription.failed", data: { subscription_id: "sub_1" } });
  assert.equal(failed.action === "subscription" && failed.status, "failed");
  assert.equal(normalizeDodoEvent("msg_other", { type: "refund.succeeded", data: {} }).action, "ignore");
});

function sign(payload: string, id: string): { headers: Headers } {
  const timestamp = new Date();
  const signature = new Webhook(webhookSecret).sign(id, timestamp, payload);
  return {
    headers: new Headers({
      "webhook-id": id,
      "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "webhook-signature": signature,
      "content-type": "application/json",
    }),
  };
}
