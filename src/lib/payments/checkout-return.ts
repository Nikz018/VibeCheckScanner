export const PAYMENT_DECLINED_COPY = "Payment didn't go through. You weren't charged.";
export const PAYMENT_CONFIRMING_COPY = "Confirming your payment…";
export const PAYMENT_TRY_AGAIN_LABEL = "Try again";
export const PAYMENT_CONFIRM_TIMEOUT_MS = 15_000;

export type PurchasePaymentStatus = "pending" | "paid" | "failed" | null;
export type RemotePaymentStatus = "succeeded" | "failed" | "cancelled" | "pending" | "unknown";
export type ReturnHint = "returned" | "failed" | "cancelled" | "absent";

export type CheckoutPanel =
  | { panel: "paid" }
  | { panel: "confirming"; recheck: boolean }
  | { panel: "declined" }
  | { panel: "upgrade" };

const FAILED_STATUS = new Set(["failed", "declined", "failure"]);
const CANCELLED_STATUS = new Set(["cancelled", "canceled", "cancel", "expired"]);
const SUCCESS_STATUS = new Set(["succeeded", "success", "paid", "active"]);

/** `status` on the return URL is a hint. `checkout=success` is not proof of payment. */
export function classifyReturnQuery(query: { checkout?: string | null; status?: string | null; payment_status?: string | null }): ReturnHint {
  const status = (query.status || query.payment_status || "").trim().toLowerCase();
  if (FAILED_STATUS.has(status)) return "failed";
  if (CANCELLED_STATUS.has(status) || query.checkout === "cancel") return "cancelled";
  if (query.checkout === "success" || SUCCESS_STATUS.has(status)) return "returned";
  return "absent";
}

export function mapIntentStatus(status: string | null | undefined): RemotePaymentStatus {
  const value = (status || "").trim().toLowerCase();
  if (value === "succeeded") return "succeeded";
  if (value === "failed") return "failed";
  if (value === "cancelled" || value === "canceled") return "cancelled";
  if (!value) return "unknown";
  return "pending";
}

/**
 * Paid progress is only for a recorded payment or a Dodo status of succeeded.
 * A return-URL success flag by itself stays on "confirming".
 */
export function checkoutPanel(input: {
  purchaseStatus: PurchasePaymentStatus;
  hint: ReturnHint;
  remote: RemotePaymentStatus | null;
  elapsedMs: number;
}): CheckoutPanel {
  if (input.purchaseStatus === "paid" || input.remote === "succeeded") return { panel: "paid" };
  if (input.purchaseStatus === "failed" || input.remote === "failed" || input.remote === "cancelled") return { panel: "declined" };
  if (input.hint === "failed" || input.hint === "cancelled") return { panel: "declined" };
  if (input.hint === "returned" && input.purchaseStatus === "pending") {
    return { panel: "confirming", recheck: input.elapsedMs >= PAYMENT_CONFIRM_TIMEOUT_MS };
  }
  return { panel: "upgrade" };
}
