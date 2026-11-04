import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { readSession } from "@/lib/auth";
import { signInPath } from "@/lib/checkout-path";
import { loginPageError } from "@/lib/session-lifetime";
import { privateMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";
export const metadata: Metadata = privateMetadata("Sign in");

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const session = await readSession();
  const params = await searchParams;
  const nextPath = safeNext(params.next);
  if (session.status === "active") redirect(nextPath);
  if (session.status === "expired" && params.error !== "session" && params.error !== "expired") {
    redirect(signInPath(nextPath, { expired: true }));
  }
  return (
    <div className="py-10">
      <LoginForm nextPath={params.next ? nextPath : undefined} error={loginPageError(params.error, session.status)} />
    </div>
  );
}

function safeNext(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}
