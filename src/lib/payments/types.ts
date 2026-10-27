import type { TierId } from "../pricing";

export type PaymentProviderId = "dodo" | "stripe";

export type BillingAddress = {
  country: string;
  street: string;
  city: string;
  state: string;
  zipcode: string;
  name?: string;
};

export type CheckoutDraft = {
  userId: string;
  email: string;
  tier: TierId;
  scanId: string;
  successUrl: string;
  cancelUrl: string;
  billing?: BillingAddress;
};

export type CheckoutSession = {
  url: string;
  sessionId: string;
};

export type NormalizedWebhook =
  | { action: "ignore"; id: string; type: string }
  | {
      action: "payment_succeeded";
      id: string;
      type: string;
      userId: string;
      tier: string;
      scanId: string;
      sessionId: string | null;
      paymentId: string | null;
      subscriptionId: string | null;
      customerId: string | null;
    }
  | {
      action: "payment_failed";
      id: string;
      type: string;
      sessionId: string | null;
      paymentId: string | null;
      errorCode: string | null;
    }
  | {
      action: "subscription";
      id: string;
      type: string;
      status: string;
      userId: string | null;
      subscriptionId: string;
      customerId: string | null;
      customerEmail: string | null;
      currentPeriodEnd: Date | null;
    };

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  webhookConfigured(): boolean;
  webhookDisabledMessage(): string;
  checkoutConfigured(): boolean;
  checkoutDisabledMessage(): string;
  createCheckout(input: CheckoutDraft): Promise<CheckoutSession>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  parseWebhook(payload: string, headers: Headers): NormalizedWebhook;
}
