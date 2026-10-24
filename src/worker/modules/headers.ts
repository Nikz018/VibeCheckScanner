import tls from "node:tls";
import type { ProbeResponse } from "@/lib/http";
import { runModule, type ScanContext } from "../context";

export const HEADER_CHECK_IDS = [
  "cors_credential_wildcard",
  "missing_csp",
  "missing_hsts",
  "insecure_cookies",
  "weak_tls",
  "missing_frame_protection",
  "missing_content_type_options",
  "missing_referrer_policy",
] as const;

export async function runHeaders(ctx: ScanContext): Promise<void> {
  await runModule([...HEADER_CHECK_IDS], ctx, async () => {
    const home = ctx.home ?? (await ctx.fetch(ctx.origin));
    const cors = ctx.corsProbe ?? home;
    const headers = lowerHeaders(home.headers);
    const corsHeaders = lowerHeaders(cors.headers);

    const csp = headers["content-security-policy"] || headers["content-security-policy-report-only"] || "";
    ctx.mark("missing_csp");
    if (!csp) ctx.add("missing_csp", "The homepage response did not include a Content-Security-Policy header.");

    const https = ctx.origin.startsWith("https:");
    ctx.mark("missing_hsts");
    if (https && !headers["strict-transport-security"]) {
      ctx.add("missing_hsts", "The HTTPS response did not include a Strict-Transport-Security header.");
    }

    ctx.mark("missing_frame_protection");
    const framed = headers["x-frame-options"] || /frame-ancestors/i.test(csp);
    if (!framed) ctx.add("missing_frame_protection", "The homepage did not send X-Frame-Options or a CSP frame-ancestors directive.");

    ctx.mark("missing_content_type_options");
    if (headers["x-content-type-options"]?.toLowerCase() !== "nosniff") {
      ctx.add("missing_content_type_options", "The homepage did not send X-Content-Type-Options: nosniff.");
    }

    ctx.mark("missing_referrer_policy");
    if (!headers["referrer-policy"]) ctx.add("missing_referrer_policy", "The homepage did not send a Referrer-Policy header.");

    ctx.mark("cors_credential_wildcard");
    const allowOrigin = corsHeaders["access-control-allow-origin"] || "";
    const allowCredentials = (corsHeaders["access-control-allow-credentials"] || "").toLowerCase() === "true";
    const wildcard = allowOrigin.trim() === "*";
    const reflectsProbe = allowOrigin === "https://vibecheck-probe.example";
    if (allowCredentials && (wildcard || reflectsProbe)) {
      ctx.add(
        "cors_credential_wildcard",
        `A cross-origin request was answered with Access-Control-Allow-Origin: ${allowOrigin || "(missing)"} and Access-Control-Allow-Credentials: true.`,
      );
    }

    ctx.mark("insecure_cookies");
    const weakCookies = home.setCookies.filter((cookie) => !cookieIsHardened(cookie));
    if (weakCookies.length > 0) {
      const names = weakCookies.map(cookieName).slice(0, 4).join(", ");
      ctx.add("insecure_cookies", `Cookie ${names} is missing HttpOnly, Secure, or SameSite.`);
    }

    ctx.mark("weak_tls");
    await inspectTransport(ctx);
  });
}

async function inspectTransport(ctx: ScanContext): Promise<void> {
  const url = new URL(ctx.origin);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol === "http:") {
    if (!local) ctx.add("weak_tls", "The origin is served over HTTP, so session traffic is not encrypted.");
    return;
  }
  try {
    const result = await inspectTls(url.hostname, Number(url.port || 443));
    const oldProtocol = result.protocol === "TLSv1" || result.protocol === "TLSv1.1";
    if (!result.authorized || oldProtocol) {
      ctx.add(
        "weak_tls",
        `The TLS handshake reported protocol ${result.protocol || "unknown"} and certificate acceptance ${result.authorized ? "yes" : "no"}.`,
      );
    }
  } catch {
    ctx.add("weak_tls", "The HTTPS endpoint did not complete a trusted TLS handshake.");
  }
}

function inspectTls(host: string, port: number): Promise<{ protocol: string; authorized: boolean }> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host, port, servername: host, timeout: 8000, rejectUnauthorized: false },
      () => {
        resolve({ protocol: socket.getProtocol() || "", authorized: socket.authorized });
        socket.end();
      },
    );
    socket.on("error", reject);
  });
}

function lowerHeaders(headers: ProbeResponse["headers"]): Record<string, string> {
  return headers;
}

function cookieName(cookie: string): string {
  return cookie.split("=", 1)[0]?.trim() || "session";
}

function cookieIsHardened(cookie: string): boolean {
  const parts = cookie.split(";").map((part) => part.trim().toLowerCase());
  const httpOnly = parts.includes("httponly");
  const secure = parts.includes("secure");
  const sameSite = parts.some((part) => part.startsWith("samesite="));
  return httpOnly && secure && sameSite;
}
