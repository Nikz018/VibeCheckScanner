import { prisma } from "../db";
import type { TierId } from "../pricing";
import { checkoutPanel, classifyReturnQuery, mapIntentStatus, type RemotePaymentStatus } from "./checkout-return";
import { getDodoClient, safeErrorCode } from "./dodo";
import { applyPaidAccess, applyPaymentFailed } from "./fulfill";
import type { PaidFullScanDeps } from "./paid-full-scan";
import { tierOrReport } from "./checkout-tier";

export interface RemoteCheckoutStatus {
  status: RemotePaymentStatus;
  paymentId: string | null;
  errorCode: string | null;
}

export type CheckoutStatusReader = (sessionId: string) => Promise<RemoteCheckoutStatus>;

export async function readDodoCheckoutStatus(sessionId: string): Promise<RemoteCheckoutStatus> {
  const client = getDodoClient();
  if (!client) return { status: "unknown", paymentId: null, errorCode: null };
  const session = await client.checkoutSessions.retrieve(sessionId);
  const paymentId = session.payment_id ?? null;
  let errorCode: string | null = null;
  if (paymentId && (session.payment_status === "failed" || session.payment_status === "cancelled")) {
    try {
      const payment = await client.payments.retrieve(paymentId);
      errorCode = safeErrorCode(payment.error_code);
    } catch {
      console.info("dodo payment lookup failed");
    }
  }
  return { status: mapIntentStatus(session.payment_status), paymentId, errorCode };
}

export async function confirmPendingPurchase(
  purchaseId: string,
  deps?: PaidFullScanDeps & { readStatus?: CheckoutStatusReader },
): Promise<"paid" | "failed" | "pending"> {
  const purchase = await prisma.purchase.findUnique({ where: { id: purchaseId } });
  if (!purchase) return "pending";
  if (purchase.status === "paid") return "paid";
  if (purchase.status === "failed") return "failed";
  if (!purchase.dodoCheckoutSession) return "pending";
  const readStatus = deps?.readStatus ?? readDodoCheckoutStatus;
  let remote: RemoteCheckoutStatus;
  try {
    remote = await readStatus(purchase.dodoCheckoutSession);
  } catch {
    console.info("dodo checkout status lookup failed");
    return "pending";
  }
  if (remote.status === "succeeded") {
    await applyPaidAccess(
      "dodo",
      {
        action: "payment_succeeded",
        id: `dodo_status_${purchase.id}`,
        type: "checkout.session.status",
        userId: purchase.userId,
        tier: purchase.tier,
        scanId: purchase.scanId || "",
        sessionId: purchase.dodoCheckoutSession,
        paymentId: remote.paymentId,
        subscriptionId: null,
        customerId: null,
      },
      deps,
    );
    const updated = await prisma.purchase.findUnique({ where: { id: purchase.id } });
    return updated?.status === "paid" ? "paid" : "pending";
  }
  if (remote.status === "failed" || remote.status === "cancelled") {
    await applyPaymentFailed({
      action: "payment_failed",
      id: `dodo_status_${purchase.id}`,
      type: "checkout.session.status",
      sessionId: purchase.dodoCheckoutSession,
      paymentId: remote.paymentId,
      errorCode: remote.errorCode,
    });
    return "failed";
  }
  return "pending";
}

export async function settlePreviewCheckout(input: {
  purchase: { id: string; status: string; tier: string; dodoCheckoutSession?: string | null } | null;
  query: { checkout?: string | null; status?: string | null; payment_status?: string | null; recheck?: string | null };
  deps?: PaidFullScanDeps & { readStatus?: CheckoutStatusReader };
}): Promise<{ kind: "paid" | "confirming" | "declined" | "upgrade"; tier: TierId }> {
  const tier = tierOrReport(input.purchase?.tier);
  const purchaseStatus = input.purchase?.status === "paid" || input.purchase?.status === "failed" || input.purchase?.status === "pending" ? input.purchase.status : null;
  const hint = classifyReturnQuery(input.query);
  if (purchaseStatus === "paid") return { kind: "paid", tier };

  if ((hint === "failed" || hint === "cancelled") && input.purchase && purchaseStatus === "pending") {
    const settled = await confirmPendingPurchase(input.purchase.id, input.deps);
    if (settled === "paid") return { kind: "paid", tier };
    if (settled === "pending") {
      await prisma.purchase.updateMany({ where: { id: input.purchase.id, status: "pending" }, data: { status: "failed" } });
    }
    return { kind: "declined", tier };
  }

  const panel = checkoutPanel({
    purchaseStatus,
    hint,
    remote: null,
    elapsedMs: input.query.recheck === "1" ? 15_000 : 0,
  });
  if (panel.panel === "declined") return { kind: "declined", tier };
  if (panel.panel === "confirming" && panel.recheck && input.purchase && purchaseStatus === "pending") {
    const settled = await confirmPendingPurchase(input.purchase.id, input.deps);
    if (settled === "paid") return { kind: "paid", tier };
    if (settled === "failed") return { kind: "declined", tier };
    return { kind: "confirming", tier };
  }
  if (panel.panel === "confirming") return { kind: "confirming", tier };
  return { kind: "upgrade", tier };
}
