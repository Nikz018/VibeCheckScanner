import type Stripe from "stripe";
import { TIERS, isTierId } from "../pricing";
import { getStripe, priceIdFor } from "../stripe";
import { InvalidSignatureError, MissingSignatureError, PaymentNotConfiguredError } from "./errors";
import type { CheckoutDraft, CheckoutSession, NormalizedWebhook, PaymentProvider } from "./types";

const CHECKOUT_DISABLED = "Stripe is not configured. Add STRIPE_SECRET_KEY and the price id for this plan.";

export function stripePaymentProvider(): PaymentProvider {
  return {
    id: "stripe",
    webhookConfigured,
    webhookDisabledMessage: () => "Stripe webhook is not configured.",
    checkoutDisabledMessage: () => CHECKOUT_DISABLED,
    createCheckout,
    cancelSubscription,
    parseWebhook,
  };
}

function webhookConfigured(): boolean {
  return Boolean(getStripe() && process.env.STRIPE_WEBHOOK_SECRET);
}

async function createCheckout(input: CheckoutDraft): Promise<CheckoutSession> {
  const stripe = getStripe();
  const price = priceIdFor(input.tier);
  if (!stripe || !price) throw new PaymentNotConfiguredError(CHECKOUT_DISABLED);
  const session = await stripe.checkout.sessions.create({
    mode: TIERS[input.tier].mode,
    line_items: [{ price, quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    customer_email: input.email,
    client_reference_id: input.userId,
    metadata: { userId: input.userId, scanId: input.scanId, tier: input.tier },
    ...(input.tier === "monitor" ? { subscription_data: { metadata: { userId: input.userId, tier: "monitor" } } } : {}),
  });
  if (!session.url) throw new PaymentNotConfiguredError("Stripe did not return a checkout link.");
  return { url: session.url, sessionId: session.id };
}

async function cancelSubscription(subscriptionId: string): Promise<void> {
  const stripe = getStripe();
  if (!stripe) throw new PaymentNotConfiguredError(CHECKOUT_DISABLED);
  await stripe.subscriptions.cancel(subscriptionId);
}

function parseWebhook(payload: string, headers: Headers): NormalizedWebhook {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = headers.get("stripe-signature");
  if (!signature) throw new MissingSignatureError();
  if (!stripe || !secret) throw new PaymentNotConfiguredError("Stripe webhook is not configured.");
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, secret);
  } catch {
    throw new InvalidSignatureError();
  }
  return normalizeStripeEvent(event);
}

export function normalizeStripeEvent(event: Stripe.Event): NormalizedWebhook {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.userId || "";
    const tier = session.metadata?.tier || "";
    const scanId = session.metadata?.scanId || "";
    if (!userId || !isTierId(tier)) return { action: "ignore", id: event.id, type: event.type };
    if (session.mode === "payment" && session.payment_status !== "paid") return { action: "ignore", id: event.id, type: event.type };
    return {
      action: "payment_succeeded",
      id: event.id,
      type: event.type,
      userId,
      tier,
      scanId,
      sessionId: session.id,
      paymentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
      subscriptionId: typeof session.subscription === "string" ? session.subscription : null,
      customerId: typeof session.customer === "string" ? session.customer : null,
    };
  }
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    const periodEndValue = (subscription as unknown as { current_period_end?: number }).current_period_end;
    return {
      action: "subscription",
      id: event.id,
      type: event.type,
      status: event.type === "customer.subscription.deleted" ? "canceled" : subscription.status,
      userId: subscription.metadata?.userId || null,
      subscriptionId: subscription.id,
      customerId: typeof subscription.customer === "string" ? subscription.customer : null,
      customerEmail: null,
      currentPeriodEnd: typeof periodEndValue === "number" ? new Date(periodEndValue * 1000) : null,
    };
  }
  return { action: "ignore", id: event.id, type: event.type };
}
