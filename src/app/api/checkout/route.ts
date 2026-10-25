import { checkoutResponse, paymentProvider } from "@/lib/payments";
import { PaymentNotConfiguredError } from "@/lib/payments/errors";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    return await checkoutResponse(request, paymentProvider());
  } catch (error) {
    if (error instanceof PaymentNotConfiguredError) return NextResponse.json({ error: error.message }, { status: 503 });
    throw error;
  }
}
