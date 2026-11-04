import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSession, SESSION_COOKIE, SESSION_EXPIRY_COOKIE } from "@/lib/auth";
import { SESSION_EXPIRED_CODE, safeReturnPath } from "@/lib/session-lifetime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const nextPath = safeReturnPath(url.searchParams.get("next"));
  const appUrl = process.env.APP_URL || url.origin;
  const session = await readSession();
  if (session.status === "active") return NextResponse.redirect(new URL(nextPath, appUrl));
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(SESSION_EXPIRY_COOKIE);
  const login = new URL("/login", appUrl);
  login.searchParams.set("next", nextPath);
  login.searchParams.set("error", SESSION_EXPIRED_CODE);
  const response = NextResponse.redirect(login);
  response.headers.set("cache-control", "no-store");
  return response;
}
