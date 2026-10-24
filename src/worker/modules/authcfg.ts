import { runModule, type ScanContext } from "../context";

export const AUTH_CHECK_IDS = ["stripe_webhook_unsigned", "signup_privileged_role", "login_missing_rate_limit", "open_redirect"] as const;

const WEBHOOK_PATHS = ["/api/stripe/webhook", "/api/webhooks/stripe", "/api/billing/webhook"];
const LOGIN_PATHS = ["/api/login", "/api/auth/login", "/api/otp"];
const REDIRECT_PATHS = ["/auth/callback", "/api/auth/callback", "/login/callback"];

export async function runAuthConfig(ctx: ScanContext): Promise<void> {
  await runModule([...AUTH_CHECK_IDS], ctx, async () => {
    ctx.mark("signup_privileged_role");
    if (/role\s*:\s*["']admin["']/.test(ctx.scriptText())) {
      ctx.add("signup_privileged_role", "Public client code sends role: \"admin\" during signup. The server must ignore that field.");
    }

    const unsigned: string[] = [];
    for (const path of WEBHOOK_PATHS) {
      const response = await ctx.fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        follow: false,
      });
      if (response.status === 404 || response.status === 405) continue;
      const json = (response.headers["content-type"] || "").includes("json") || response.body.trim().startsWith("{");
      const mentionsSignature = /signature/i.test(response.body);
      if (response.status < 300 && json && !mentionsSignature) unsigned.push(`${path} returned ${response.status}`);
    }
    ctx.mark("stripe_webhook_unsigned");
    if (unsigned.length > 0) {
      ctx.add("stripe_webhook_unsigned", `An unsigned empty POST was accepted: ${unsigned.join("; ")}.`);
    }

    ctx.mark("login_missing_rate_limit");
    for (const path of LOGIN_PATHS) {
      const payload = JSON.stringify({ email: "vibecheck-probe@example.com", password: "not-a-real-password" });
      const init = { method: "POST" as const, headers: { "content-type": "application/json" }, body: payload, follow: false };
      const first = await ctx.fetch(path, init);
      if (first.status === 404) continue;
      const looksLikeLogin =
        (first.headers["content-type"] || "").includes("json") || first.status === 401 || first.status === 400 || first.status === 422;
      if (!looksLikeLogin) continue;
      const second = await ctx.fetch(path, init);
      const limited = first.status === 429 || second.status === 429 || hasRateLimit(first.headers) || hasRateLimit(second.headers);
      if (!limited && first.status < 500 && second.status < 500) {
        ctx.add("login_missing_rate_limit", `${path} accepted two invalid login attempts without a 429 or a rate-limit header.`);
      }
      break;
    }

    ctx.mark("open_redirect");
    for (const path of REDIRECT_PATHS) {
      const response = await ctx.fetch(`${path}?next=${encodeURIComponent("https://example.com")}`, { follow: false });
      if (response.status === 404) continue;
      const host = locationHost(response.location, ctx.origin);
      if ((response.status === 301 || response.status === 302 || response.status === 303 || response.status === 307) && host === "example.com") {
        ctx.add("open_redirect", `${path} redirected to example.com based on the next parameter.`);
        break;
      }
    }
  });
}

function hasRateLimit(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((key) => key === "retry-after" || key.includes("ratelimit") || key.includes("rate-limit"));
}

function locationHost(location: string | null, base: string): string | null {
  if (!location) return null;
  try {
    return new URL(location, base).hostname;
  } catch {
    return null;
  }
}
