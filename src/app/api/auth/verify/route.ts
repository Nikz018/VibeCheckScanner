import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, consumeMagicLink, cookieOptions } from "@/lib/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const nextPath = safeNext(url.searchParams.get("next"));
  const session = await consumeMagicLink(token);
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  if (!session) return NextResponse.redirect(new URL("/login?error=expired", appUrl));
  const jar = await cookies();
  jar.set(SESSION_COOKIE, session, cookieOptions());
  return NextResponse.redirect(new URL(nextPath, appUrl));
}

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}
