import { dodoPaymentProvider } from "@/lib/payments/dodo";
import { handleProviderWebhook } from "@/lib/payments/webhook";

export async function POST(request: Request) {
  return handleProviderWebhook(dodoPaymentProvider(), request);
}
