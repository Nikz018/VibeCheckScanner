import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { cancelMonitoring } from "@/lib/payments";
import { PaymentNotConfiguredError, PaymentRequestError } from "@/lib/payments/errors";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    await cancelMonitoring(user.id);
    return NextResponse.json({ status: "canceled" });
  } catch (error) {
    if (error instanceof PaymentRequestError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof PaymentNotConfiguredError) return NextResponse.json({ error: error.message }, { status: 503 });
    console.error("subscription cancel failed", error);
    return NextResponse.json({ error: "Could not cancel the subscription. Try again." }, { status: 502 });
  }
}
