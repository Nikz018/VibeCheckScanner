import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { isTierId, type TierId } from "@/lib/pricing";
import { getStripe } from "@/lib/stripe";

export async function POST(request: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    await prisma.stripeEvent.create({ data: { id: event.id, type: event.type } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ received: true });
    }
    throw error;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    await applyCheckout(session);
  }
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    await applySubscription(subscription, event.type === "customer.subscription.deleted");
  }
  return NextResponse.json({ received: true });
}

async function applyCheckout(session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.metadata?.userId;
  const tierValue = session.metadata?.tier || "";
  if (!userId || !isTierId(tierValue)) return;
  if (session.mode === "payment" && session.payment_status !== "paid") return;
  const tier: TierId = tierValue;
  const scanId = session.metadata?.scanId || "";
  await prisma.purchase.updateMany({
    where: { stripeCheckoutSession: session.id },
    data: { status: "paid", stripePaymentIntent: typeof session.payment_intent === "string" ? session.payment_intent : null },
  });

  if (tier === "monitor") {
    const subscriptionId = typeof session.subscription === "string" ? session.subscription : null;
    const customerId = typeof session.customer === "string" ? session.customer : null;
    await prisma.subscription.upsert({
      where: { userId },
      update: { status: "active", stripeSubscriptionId: subscriptionId, stripeCustomerId: customerId },
      create: { userId, status: "active", stripeSubscriptionId: subscriptionId, stripeCustomerId: customerId },
    });
    return;
  }

  if (scanId) {
    await prisma.scan.updateMany({ where: { id: scanId, userId }, data: { reportAccess: "full" } });
  } else if (tier === "report") {
    await prisma.user.update({ where: { id: userId }, data: { reportCredits: { increment: 1 } } });
  }
  if (tier === "rescan") {
    await prisma.user.update({ where: { id: userId }, data: { rescanCredits: { increment: 1 } } });
    if (!scanId) {
      await prisma.user.update({ where: { id: userId }, data: { reportCredits: { increment: 1 } } });
    }
  }
}

async function applySubscription(subscription: Stripe.Subscription, deleted: boolean): Promise<void> {
  const userId = subscription.metadata?.userId;
  const stripeSubscriptionId = subscription.id;
  const status = deleted ? "canceled" : subscription.status;
  const periodEndValue = (subscription as unknown as { current_period_end?: number }).current_period_end;
  const currentPeriodEnd = typeof periodEndValue === "number" ? new Date(periodEndValue * 1000) : null;
  const customerId = typeof subscription.customer === "string" ? subscription.customer : null;
  if (userId) {
    await prisma.subscription.upsert({
      where: { userId },
      update: { status, stripeSubscriptionId, stripeCustomerId: customerId, currentPeriodEnd },
      create: { userId, status, stripeSubscriptionId, stripeCustomerId: customerId, currentPeriodEnd },
    });
    return;
  }
  await prisma.subscription.updateMany({
    where: { stripeSubscriptionId },
    data: { status, currentPeriodEnd, stripeCustomerId: customerId },
  });
}
