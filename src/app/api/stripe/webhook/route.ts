import { stripePaymentProvider } from "@/lib/payments/stripe-provider";
import { handleProviderWebhook } from "@/lib/payments/webhook";

export async function POST(request: Request) {
  return handleProviderWebhook(stripePaymentProvider(), request);
}
