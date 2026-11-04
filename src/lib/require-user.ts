import { redirect } from "next/navigation";
import { readSession } from "./auth";
import { signInPath } from "./checkout-path";

export async function requirePageUser(nextPath: string) {
  const session = await readSession();
  if (session.status === "active") return session.user;
  redirect(signInPath(nextPath, { expired: session.status === "expired" }));
}
