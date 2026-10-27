import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "../auth";
import { prisma } from "../db";
import { isTierId, type TierId } from "../pricing";
import { dodoPaymentProvider, parseBilling } from "./dodo";
import { PaymentNotConfiguredError, PaymentRequestError } from "./errors";
import { stripePaymentProvider } from "./stripe-provider";
import type { BillingAddress, PaymentProvider, PaymentProviderId } from "./types";

export function paymentProviderId(): PaymentProviderId | null {
  const value = (process.env.PAYMENT_PROVIDER || "dodo").trim().toLowerCase();
  if (value === "dodo" || value === "stripe") return value;
  return null;
}

export function paymentProvider(): PaymentProvider {
  const id = paymentProviderId();
  if (id === "stripe") return stripePaymentProvider();
  if (id === "dodo") return dodoPaymentProvider();
  throw new PaymentNotConfiguredError("Set PAYMENT_PROVIDER to dodo or stripe.");
}

export function collectsBillingAddress(): boolean {
  return paymentProviderId() === "dodo";
}

export function prepareCheckout(provider: PaymentProvider, billing: unknown): BillingAddress | undefined {
  if (!provider.checkoutConfigured()) throw new PaymentNotConfiguredError(provider.checkoutDisabledMessage());
  if (provider.id === "dodo") return parseBilling(billing);
  return undefined;
}

export async function checkoutResponse(request: Request, provider: PaymentProvider): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const parsed = z
    .object({
      tier: z.string(),
      scanId: z.string().optional(),
      billing: z
        .object({
          country: z.string().optional(),
          street: z.string().optional(),
          city: z.string().optional(),
          state: z.string().optional(),
          zipcode: z.string().optional(),
          name: z.string().optional(),
        })
        .optional(),
    })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isTierId(parsed.data.tier)) return NextResponse.json({ error: "Unknown plan." }, { status: 400 });
  const tier: TierId = parsed.data.tier;
  let scanId = "";
  if (parsed.data.scanId) {
    const scan = await prisma.scan.findFirst({ where: { id: parsed.data.scanId, userId: user.id } });
    if (!scan) return NextResponse.json({ error: "Scan not found." }, { status: 404 });
    scanId = scan.id;
  }
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const successPath = scanId ? `/scans/${scanId}?checkout=success` : "/dashboard?checkout=success";
  const cancelPath = scanId ? `/scans/${scanId}?checkout=cancel` : "/dashboard?checkout=cancel";
  try {
    const billing = prepareCheckout(provider, parsed.data.billing);
    const session = await provider.createCheckout({
      userId: user.id,
      email: user.email,
      tier,
      scanId,
      successUrl: `${appUrl}${successPath}`,
      cancelUrl: `${appUrl}${cancelPath}`,
      billing,
    });
    await prisma.purchase.create({
      data: {
        userId: user.id,
        scanId: scanId || null,
        tier,
        status: "pending",
        ...(provider.id === "stripe" ? { stripeCheckoutSession: session.sessionId } : { dodoCheckoutSession: session.sessionId }),
      },
    });
    return NextResponse.json({ url: session.url });
  } catch (error) {
    if (error instanceof PaymentRequestError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof PaymentNotConfiguredError) return NextResponse.json({ error: error.message }, { status: 503 });
    throw error;
  }
}

export function subscriptionCancelTarget(
  row: { dodoSubscriptionId: string | null; stripeSubscriptionId: string | null },
  preferred: PaymentProviderId | null,
): { provider: PaymentProviderId; subscriptionId: string } | null {
  if (preferred === "dodo" && row.dodoSubscriptionId) return { provider: "dodo", subscriptionId: row.dodoSubscriptionId };
  if (preferred === "stripe" && row.stripeSubscriptionId) return { provider: "stripe", subscriptionId: row.stripeSubscriptionId };
  if (row.dodoSubscriptionId) return { provider: "dodo", subscriptionId: row.dodoSubscriptionId };
  if (row.stripeSubscriptionId) return { provider: "stripe", subscriptionId: row.stripeSubscriptionId };
  return null;
}

export async function cancelMonitoring(userId: string): Promise<void> {
  const row = await prisma.subscription.findUnique({ where: { userId } });
  if (!row || (row.status !== "active" && row.status !== "trialing")) {
    throw new PaymentRequestError("No active monitoring subscription.");
  }
  const target = subscriptionCancelTarget(row, paymentProviderId());
  if (!target) throw new PaymentRequestError("No subscription to cancel.");
  const provider = target.provider === "stripe" ? stripePaymentProvider() : dodoPaymentProvider();
  await provider.cancelSubscription(target.subscriptionId);
  await prisma.subscription.update({ where: { userId }, data: { status: "canceled" } });
}
