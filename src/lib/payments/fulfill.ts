import { prisma } from "../db";
import { isTierId, type TierId } from "../pricing";
import { paymentFailureLog } from "./dodo";
import { fulfillPaidMiniScan, type PaidFullScanDeps } from "./paid-full-scan";
import type { NormalizedWebhook, PaymentProviderId } from "./types";

type PaidEvent = Extract<NormalizedWebhook, { action: "payment_succeeded" }>;
type FailedEvent = Extract<NormalizedWebhook, { action: "payment_failed" }>;
type SubscriptionEvent = Extract<NormalizedWebhook, { action: "subscription" }>;

export async function applyPaidAccess(provider: PaymentProviderId, event: PaidEvent, deps?: PaidFullScanDeps): Promise<void> {
  const resolved = provider === "dodo" ? await resolveDodoPurchase(event) : event;
  if (!resolved.userId || !isTierId(resolved.tier)) return;
  const tier: TierId = resolved.tier;
  const userId = resolved.userId;
  const purchase = await findPurchase(provider, resolved);
  const alreadyPaid = purchase?.status === "paid";
  const scanId = resolved.scanId || purchase?.scanId || "";

  if (provider === "stripe" && event.sessionId) {
    await prisma.purchase.updateMany({
      where: { stripeCheckoutSession: event.sessionId },
      data: { status: "paid", stripePaymentIntent: event.paymentId },
    });
  }
  if (provider === "dodo" && (event.sessionId || event.paymentId)) {
    await prisma.purchase.updateMany({
      where: event.sessionId ? { dodoCheckoutSession: event.sessionId } : { dodoPaymentId: event.paymentId || "" },
      data: { status: "paid", ...(event.paymentId ? { dodoPaymentId: event.paymentId } : {}) },
    });
  }

  if (tier === "monitor") {
    if (provider === "stripe") {
      await prisma.subscription.upsert({
        where: { userId },
        update: { status: "active", stripeSubscriptionId: event.subscriptionId, stripeCustomerId: event.customerId },
        create: { userId, status: "active", stripeSubscriptionId: event.subscriptionId, stripeCustomerId: event.customerId },
      });
    } else {
      await prisma.subscription.upsert({
        where: { userId },
        update: {
          status: "active",
          ...(event.subscriptionId ? { dodoSubscriptionId: event.subscriptionId } : {}),
          ...(event.customerId ? { dodoCustomerId: event.customerId } : {}),
        },
        create: {
          userId,
          status: "active",
          dodoSubscriptionId: event.subscriptionId,
          dodoCustomerId: event.customerId,
        },
      });
    }
    return;
  }

  const linked = purchase && purchase.userId === userId ? purchase : null;
  const preview = scanId ? await prisma.scan.findFirst({ where: { id: scanId, userId }, select: { mode: true } }) : null;
  if (linked && preview?.mode === "mini" && (tier === "report" || tier === "rescan")) {
    if (!alreadyPaid && tier === "rescan") {
      await prisma.user.update({ where: { id: userId }, data: { rescanCredits: { increment: 1 } } });
    }
    await fulfillPaidMiniScan({ userId, purchaseId: linked.id, deps });
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

export async function applyPaymentFailed(event: FailedEvent): Promise<void> {
  console.info(paymentFailureLog(event.errorCode));
  if (!event.sessionId && !event.paymentId) return;
  await prisma.purchase.updateMany({
    where: {
      ...(event.sessionId ? { dodoCheckoutSession: event.sessionId } : { dodoPaymentId: event.paymentId || "" }),
      status: { not: "paid" },
    },
    data: { status: "failed", ...(event.paymentId ? { dodoPaymentId: event.paymentId } : {}) },
  });
}

export async function applySubscription(provider: PaymentProviderId, event: SubscriptionEvent): Promise<void> {
  if (provider === "stripe") {
    if (event.userId) {
      await prisma.subscription.upsert({
        where: { userId: event.userId },
        update: {
          status: event.status,
          stripeSubscriptionId: event.subscriptionId,
          stripeCustomerId: event.customerId,
          currentPeriodEnd: event.currentPeriodEnd,
        },
        create: {
          userId: event.userId,
          status: event.status,
          stripeSubscriptionId: event.subscriptionId,
          stripeCustomerId: event.customerId,
          currentPeriodEnd: event.currentPeriodEnd,
        },
      });
      return;
    }
    await prisma.subscription.updateMany({
      where: { stripeSubscriptionId: event.subscriptionId },
      data: { status: event.status, currentPeriodEnd: event.currentPeriodEnd, stripeCustomerId: event.customerId },
    });
    return;
  }

  let userId = event.userId;
  if (!userId && event.subscriptionId) {
    const existing = await prisma.subscription.findUnique({ where: { dodoSubscriptionId: event.subscriptionId } });
    userId = existing?.userId || null;
  }
  if (!userId && event.customerEmail) {
    const user = await prisma.user.findFirst({ where: { email: { equals: event.customerEmail, mode: "insensitive" } } });
    userId = user?.id || null;
  }
  if (userId) {
    await prisma.subscription.upsert({
      where: { userId },
      update: {
        status: event.status,
        dodoSubscriptionId: event.subscriptionId,
        dodoCustomerId: event.customerId,
        currentPeriodEnd: event.currentPeriodEnd,
      },
      create: {
        userId,
        status: event.status,
        dodoSubscriptionId: event.subscriptionId,
        dodoCustomerId: event.customerId,
        currentPeriodEnd: event.currentPeriodEnd,
      },
    });
    return;
  }
  await prisma.subscription.updateMany({
    where: { dodoSubscriptionId: event.subscriptionId },
    data: { status: event.status, currentPeriodEnd: event.currentPeriodEnd, dodoCustomerId: event.customerId },
  });
}

async function findPurchase(provider: PaymentProviderId, event: PaidEvent) {
  if (provider === "stripe" && event.sessionId) {
    return prisma.purchase.findUnique({ where: { stripeCheckoutSession: event.sessionId } });
  }
  if (provider === "dodo" && event.sessionId) {
    return prisma.purchase.findUnique({ where: { dodoCheckoutSession: event.sessionId } });
  }
  if (provider === "dodo" && event.paymentId) {
    return prisma.purchase.findFirst({ where: { dodoPaymentId: event.paymentId } });
  }
  return null;
}

async function resolveDodoPurchase(event: PaidEvent): Promise<PaidEvent> {
  if (event.userId && isTierId(event.tier)) return event;
  if (!event.sessionId) return event;
  const purchase = await prisma.purchase.findUnique({ where: { dodoCheckoutSession: event.sessionId } });
  if (!purchase || !isTierId(purchase.tier)) return event;
  return {
    ...event,
    userId: purchase.userId,
    tier: purchase.tier,
    scanId: purchase.scanId || event.scanId,
  };
}
