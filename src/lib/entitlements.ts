import { prisma } from "./db";

export async function resolveReportAccess(userId: string, choice: "teaser" | "credit" | "rescan"): Promise<"teaser" | "full"> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { subscription: true },
  });
  if (!user) return "teaser";
  if (user.subscription && (user.subscription.status === "active" || user.subscription.status === "trialing")) {
    return "full";
  }
  if (choice === "credit" && user.reportCredits > 0) {
    await prisma.user.update({ where: { id: userId }, data: { reportCredits: { decrement: 1 } } });
    return "full";
  }
  if (choice === "rescan" && user.rescanCredits > 0) {
    await prisma.user.update({ where: { id: userId }, data: { rescanCredits: { decrement: 1 } } });
    return "full";
  }
  return "teaser";
}

export function monitoringActive(status: string | null | undefined): boolean {
  return status === "active" || status === "trialing";
}
