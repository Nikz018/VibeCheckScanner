import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "../db";
import { InvalidSignatureError, MissingSignatureError } from "./errors";
import { applyPaidAccess, applyPaymentFailed, applySubscription } from "./fulfill";
import type { PaymentProvider } from "./types";

export async function handleProviderWebhook(provider: PaymentProvider, request: Request): Promise<NextResponse> {
  if (!provider.webhookConfigured()) {
    return NextResponse.json({ error: provider.webhookDisabledMessage() }, { status: 503 });
  }
  const payload = await request.text();
  let event;
  try {
    event = provider.parseWebhook(payload, request.headers);
  } catch (error) {
    if (error instanceof MissingSignatureError) return NextResponse.json({ error: "Missing signature." }, { status: 400 });
    if (error instanceof InvalidSignatureError) return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
    throw error;
  }

  const recorded = await recordEvent(provider.id, event.id, event.type);
  if (!recorded) return NextResponse.json({ received: true });

  try {
    if (event.action === "payment_succeeded") await applyPaidAccess(provider.id, event);
    if (event.action === "payment_failed") await applyPaymentFailed(event);
    if (event.action === "subscription") await applySubscription(provider.id, event);
  } catch (error) {
    await deleteEvent(provider.id, event.id);
    throw error;
  }
  return NextResponse.json({ received: true });
}

async function recordEvent(provider: "stripe" | "dodo", id: string, type: string): Promise<boolean> {
  try {
    if (provider === "stripe") await prisma.stripeEvent.create({ data: { id, type } });
    else await prisma.dodoEvent.create({ data: { id, type } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}

async function deleteEvent(provider: "stripe" | "dodo", id: string): Promise<void> {
  if (provider === "stripe") await prisma.stripeEvent.delete({ where: { id } }).catch(() => undefined);
  else await prisma.dodoEvent.delete({ where: { id } }).catch(() => undefined);
}
