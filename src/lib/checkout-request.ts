import { CHECKOUT_SETUP_MESSAGE, type TierId } from "./pricing";

export type CheckoutBilling = {
  country: string;
  street: string;
  city: string;
  state: string;
  zipcode: string;
  name?: string;
};

export type CheckoutRequestResult = { ok: true; url: string } | { ok: false; status: number; error: string };

export async function requestCheckout(input: {
  tier: TierId;
  scanId?: string;
  billing?: CheckoutBilling;
}): Promise<CheckoutRequestResult> {
  let response: Response;
  try {
    response = await fetch("/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tier: input.tier,
        ...(input.scanId ? { scanId: input.scanId } : {}),
        ...(input.billing ? { billing: input.billing } : {}),
      }),
    });
  } catch {
    return { ok: false, status: 0, error: "Checkout is not available yet." };
  }
  const data = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
  if (response.status === 503) return { ok: false, status: 503, error: CHECKOUT_SETUP_MESSAGE };
  if (!response.ok || !data?.url) {
    return { ok: false, status: response.status, error: data?.error || "Checkout is not available yet." };
  }
  return { ok: true, url: data.url };
}
