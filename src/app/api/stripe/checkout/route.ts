import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isTierId } from "@/lib/pricing";
import { TIERS, getStripe, priceIdFor } from "@/lib/stripe";

const bodySchema = z.object({
  tier: z.string(),
  scanId: z.string().optional(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isTierId(parsed.data.tier)) {
    return NextResponse.json({ error: "Unknown plan." }, { status: 400 });
  }
  const tier = parsed.data.tier;
  const stripe = getStripe();
  const price = priceIdFor(tier);
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  if (!stripe || !price) {
    return NextResponse.json(
      { error: "Stripe is not configured. Add STRIPE_SECRET_KEY and the price id for this plan." },
      { status: 503 },
    );
  }
  let scanId = "";
  if (parsed.data.scanId) {
    const scan = await prisma.scan.findFirst({ where: { id: parsed.data.scanId, userId: user.id } });
    if (!scan) return NextResponse.json({ error: "Scan not found." }, { status: 404 });
    scanId = scan.id;
  }
  const successPath = scanId ? `/scans/${scanId}?checkout=success` : "/dashboard?checkout=success";
  const cancelPath = scanId ? `/scans/${scanId}?checkout=cancel` : "/dashboard?checkout=cancel";
  const session = await stripe.checkout.sessions.create({
    mode: TIERS[tier].mode,
    line_items: [{ price, quantity: 1 }],
    success_url: `${appUrl}${successPath}`,
    cancel_url: `${appUrl}${cancelPath}`,
    customer_email: user.email,
    client_reference_id: user.id,
    metadata: { userId: user.id, scanId, tier },
    ...(tier === "monitor" ? { subscription_data: { metadata: { userId: user.id, tier: "monitor" } } } : {}),
  });
  await prisma.purchase.create({
    data: {
      userId: user.id,
      scanId: scanId || null,
      tier,
      stripeCheckoutSession: session.id,
      status: "pending",
    },
  });
  return NextResponse.json({ url: session.url });
}
