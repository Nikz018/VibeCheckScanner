import DodoPayments from "dodopayments";
import type { CheckoutSessionCreateParams } from "dodopayments/resources/checkout-sessions";
import type { CountryCode } from "dodopayments/resources/misc";
import { CHECKOUT_SETUP_MESSAGE, DEFAULT_DODO_PRODUCT_IDS, TIERS, type TierId } from "../pricing";
import { InvalidSignatureError, MissingSignatureError, PaymentNotConfiguredError, PaymentRequestError } from "./errors";
import type { BillingAddress, CheckoutDraft, CheckoutSession, NormalizedWebhook, PaymentProvider } from "./types";

const CHECKOUT_DISABLED = "Dodo Payments is not configured. Add DODO_PAYMENTS_API_KEY and the product id for this plan.";

type DodoApi = {
  checkoutSessions: {
    create: (body: CheckoutSessionCreateParams) => Promise<{ session_id: string; checkout_url?: string | null }>;
  };
  subscriptions: {
    update: (id: string, body: { status?: "cancelled" }) => Promise<unknown>;
  };
  webhooks: {
    unwrap: (body: string, options: { headers: Record<string, string>; key?: string }) => unknown;
  };
};

export function dodoEnvironment(): "test_mode" | "live_mode" {
  return process.env.DODO_ENV === "live_mode" ? "live_mode" : "test_mode";
}

export function dodoProductId(tier: TierId): string {
  const value = process.env[TIERS[tier].dodoEnv]?.trim();
  return value || DEFAULT_DODO_PRODUCT_IDS[tier];
}

export function getDodoClient(): DodoPayments | null {
  const bearerToken = process.env.DODO_PAYMENTS_API_KEY?.trim();
  if (!bearerToken) return null;
  const webhookKey = process.env.DODO_WEBHOOK_SECRET?.trim() || null;
  return new DodoPayments({ bearerToken, environment: dodoEnvironment(), webhookKey });
}

export function dodoPaymentProvider(client?: DodoApi): PaymentProvider {
  const api = () => client || getDodoClient();
  return {
    id: "dodo",
    webhookConfigured: () => Boolean(process.env.DODO_PAYMENTS_API_KEY?.trim() && process.env.DODO_WEBHOOK_SECRET?.trim()),
    webhookDisabledMessage: () => "Dodo webhook is not configured.",
    checkoutConfigured: () => Boolean(client) || Boolean(process.env.DODO_PAYMENTS_API_KEY?.trim()),
    checkoutDisabledMessage: () => CHECKOUT_SETUP_MESSAGE,
    createCheckout: (input) => createCheckout(api(), input),
    cancelSubscription: (subscriptionId) => cancelSubscription(api(), subscriptionId),
    parseWebhook: (payload, headers) => parseWebhook(api(), payload, headers),
  };
}

export function parseBilling(input: unknown): BillingAddress {
  if (!input || typeof input !== "object") {
    throw new PaymentRequestError("Enter a billing country and address.");
  }
  const raw = input as Record<string, unknown>;
  const country = text(raw.country).toUpperCase();
  const street = text(raw.street);
  const city = text(raw.city);
  const state = text(raw.state);
  const zipcode = text(raw.zipcode);
  const name = text(raw.name);
  if (!/^[A-Z]{2}$/.test(country) || !street || !city || !state || !zipcode) {
    throw new PaymentRequestError("Enter a 2-letter billing country plus street, city, state, and postal code.");
  }
  return { country, street, city, state, zipcode, ...(name ? { name } : {}) };
}

export function normalizeDodoEvent(eventId: string, payload: unknown): NormalizedWebhook {
  const body = record(payload);
  const type = text(body.type) || "unknown";
  const data = record(body.data);
  const metadata = record(data.metadata);
  const customer = readCustomer(data.customer);
  if (type === "payment.succeeded" || type === "payment.failed") {
    const sessionId = text(data.checkout_session_id) || null;
    const paymentId = text(data.payment_id) || null;
    if (type === "payment.failed") return { action: "payment_failed", id: eventId, type, sessionId, paymentId };
    return {
      action: "payment_succeeded",
      id: eventId,
      type,
      userId: text(metadata.userId),
      tier: text(metadata.tier),
      scanId: text(metadata.scanId),
      sessionId,
      paymentId,
      subscriptionId: text(data.subscription_id) || null,
      customerId: customer.id,
    };
  }
  if (type === "subscription.active" || type === "subscription.renewed" || type === "subscription.cancelled" || type === "subscription.failed") {
    const subscriptionId = text(data.subscription_id);
    if (!subscriptionId) return { action: "ignore", id: eventId, type };
    const status = type === "subscription.active" || type === "subscription.renewed" ? "active" : type === "subscription.cancelled" ? "canceled" : "failed";
    return {
      action: "subscription",
      id: eventId,
      type,
      status,
      userId: text(metadata.userId) || null,
      subscriptionId,
      customerId: customer.id,
      customerEmail: customer.email,
      currentPeriodEnd: dateOrNull(data.next_billing_date),
    };
  }
  return { action: "ignore", id: eventId, type };
}

async function createCheckout(client: DodoApi | null, input: CheckoutDraft): Promise<CheckoutSession> {
  const productId = dodoProductId(input.tier);
  if (!client || !productId) throw new PaymentNotConfiguredError(CHECKOUT_SETUP_MESSAGE);
  if (!input.billing) throw new PaymentRequestError("Enter a billing country and address.");
  const session = await client.checkoutSessions.create({
    product_cart: [{ product_id: productId, quantity: 1 }],
    customer: { email: input.email, ...(input.billing.name ? { name: input.billing.name } : {}) },
    billing_address: {
      country: input.billing.country as CountryCode,
      street: input.billing.street,
      city: input.billing.city,
      state: input.billing.state,
      zipcode: input.billing.zipcode,
    },
    billing_currency: "USD",
    return_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata: { userId: input.userId, scanId: input.scanId, tier: input.tier },
    minimal_address: false,
    feature_flags: {
      allow_customer_editing_country: true,
      allow_customer_editing_street: true,
      allow_customer_editing_city: true,
      allow_customer_editing_state: true,
      allow_customer_editing_zipcode: true,
      allow_customer_editing_name: true,
    },
  });
  if (!session.checkout_url) throw new PaymentNotConfiguredError("Dodo Payments did not return a checkout link.");
  return { url: session.checkout_url, sessionId: session.session_id };
}

async function cancelSubscription(client: DodoApi | null, subscriptionId: string): Promise<void> {
  if (!client) throw new PaymentNotConfiguredError(CHECKOUT_DISABLED);
  await client.subscriptions.update(subscriptionId, { status: "cancelled" });
}

function parseWebhook(client: DodoApi | null, payload: string, headers: Headers): NormalizedWebhook {
  const webhookId = headers.get("webhook-id") || "";
  const signature = headers.get("webhook-signature") || "";
  const timestamp = headers.get("webhook-timestamp") || "";
  if (!webhookId || !signature || !timestamp) throw new MissingSignatureError();
  const secret = process.env.DODO_WEBHOOK_SECRET?.trim();
  if (!client || !secret) throw new PaymentNotConfiguredError("Dodo webhook is not configured.");
  try {
    const parsed = client.webhooks.unwrap(payload, {
      headers: { "webhook-id": webhookId, "webhook-signature": signature, "webhook-timestamp": timestamp },
      key: secret,
    });
    return normalizeDodoEvent(webhookId, parsed);
  } catch (error) {
    if (error instanceof MissingSignatureError || error instanceof PaymentNotConfiguredError) throw error;
    throw new InvalidSignatureError();
  }
}

function readCustomer(value: unknown): { id: string | null; email: string | null } {
  const customer = record(value);
  return {
    id: text(customer.customer_id) || null,
    email: text(customer.email) || null,
  };
}

function dateOrNull(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
