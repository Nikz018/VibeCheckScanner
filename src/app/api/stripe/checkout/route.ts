import { checkoutResponse } from "@/lib/payments";
import { stripePaymentProvider } from "@/lib/payments/stripe-provider";

export async function POST(request: Request) {
  return checkoutResponse(request, stripePaymentProvider());
}
