import tls from "node:tls";
import { reproduce } from "@/lib/finding-detail";
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
    if (!csp) {
      ctx.add(
        "missing_csp",
        "The homepage response did not include a Content-Security-Policy header.",
        ctx.detailFor(home, {
          requestHeaders: { accept: "text/html" },
          steps: reproduce("GET", home.url, "The response headers do not include Content-Security-Policy.", "Send a policy that limits scripts to your origin."),
        }),
      );
    }

    const https = ctx.origin.startsWith("https:");
    ctx.mark("missing_hsts");
    if (https && !headers["strict-transport-security"]) {
      ctx.add(
        "missing_hsts",
        "The HTTPS response did not include a Strict-Transport-Security header.",
        ctx.detailFor(home, {
          requestHeaders: { accept: "text/html" },
          steps: reproduce("GET", home.url, "The response headers do not include Strict-Transport-Security.", "Send HSTS on HTTPS responses."),
        }),
      );
    }

    ctx.mark("missing_frame_protection");
    const framed = headers["x-frame-options"] || /frame-ancestors/i.test(csp);
    if (!framed) {
      ctx.add(
        "missing_frame_protection",
        "The homepage did not send X-Frame-Options or a CSP frame-ancestors directive.",
        ctx.detailFor(home, {
          requestHeaders: { accept: "text/html" },
          steps: reproduce("GET", home.url, "The response can be embedded in a frame.", "Send frame-ancestors 'none' or X-Frame-Options: DENY."),
        }),
      );
    }

    ctx.mark("missing_content_type_options");
    if (headers["x-content-type-options"]?.toLowerCase() !== "nosniff") {
      ctx.add(
        "missing_content_type_options",
        "The homepage did not send X-Content-Type-Options: nosniff.",
        ctx.detailFor(home, {
          requestHeaders: { accept: "text/html" },
          steps: reproduce("GET", home.url, "The response headers do not include X-Content-Type-Options: nosniff."),
        }),
      );
    }

    ctx.mark("missing_referrer_policy");
    if (!headers["referrer-policy"]) {
      ctx.add(
        "missing_referrer_policy",
        "The homepage did not send a Referrer-Policy header.",
        ctx.detailFor(home, {
          requestHeaders: { accept: "text/html" },
          steps: reproduce("GET", home.url, "The response headers do not include Referrer-Policy."),
        }),
      );
    }

    ctx.mark("cors_credential_wildcard");
    const allowOrigin = corsHeaders["access-control-allow-origin"] || "";
    const allowCredentials = (corsHeaders["access-control-allow-credentials"] || "").toLowerCase() === "true";
    const wildcard = allowOrigin.trim() === "*";
    const reflectsProbe = allowOrigin === "https://vibecheck-probe.example";
    if (allowCredentials && (wildcard || reflectsProbe)) {
      ctx.add(
        "cors_credential_wildcard",
        "A cross-origin request was answered with a reflected or wildcard origin and credentials allowed.",
        ctx.detailFor(cors, {
          requestHeaders: { accept: "text/html", origin: "https://vibecheck-probe.example" },
          steps: reproduce(
            "GET",
            cors.url,
            `The response allows origin ${allowOrigin || "(missing)"} with credentials.`,
            "Reflect only origins you operate, and do not combine a wildcard with credentials.",
          ),
        }),
      );
    }

    ctx.mark("insecure_cookies");
    const weakCookies = home.setCookies.filter((cookie) => !cookieIsHardened(cookie));
    if (weakCookies.length > 0) {
      const names = weakCookies.map(cookieName).slice(0, 4).join(", ");
      const shown = weakCookies.slice(0, 4).map(redactCookieFlags);
      ctx.add(
        "insecure_cookies",
        `Cookie ${names} is missing HttpOnly, Secure, or SameSite.`,
        ctx.detailFor(home, {
          requestHeaders: { accept: "text/html" },
          snippetLines: shown.map((cookie) => `set-cookie: ${cookie}`),
          steps: reproduce("GET", home.url, `Set-Cookie for ${names} is missing HttpOnly, Secure, or SameSite.`),
        }),
      );
    }

    ctx.mark("weak_tls");
    await inspectTransport(ctx);
  });
}

async function inspectTransport(ctx: ScanContext): Promise<void> {
  const url = new URL(ctx.origin);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  const home = ctx.home;
  if (url.protocol === "http:") {
    if (!local && home) {
      ctx.add(
        "weak_tls",
        "The origin is served over HTTP, so session traffic is not encrypted.",
        ctx.detailFor(home, {
          steps: reproduce("GET", home.url, "The URL scheme is http, so the response is not encrypted.", "Serve the app only over HTTPS."),
        }),
      );
    }
    return;
  }
  try {
    const result = await inspectTls(url.hostname, Number(url.port || 443));
    const oldProtocol = result.protocol === "TLSv1" || result.protocol === "TLSv1.1";
    if ((!result.authorized || oldProtocol) && home) {
      ctx.add(
        "weak_tls",
        `The TLS handshake reported protocol ${result.protocol || "unknown"} and certificate acceptance ${result.authorized ? "yes" : "no"}.`,
        ctx.detailFor(home, {
          snippetLines: [`protocol: ${result.protocol || "unknown"}`, `trusted certificate: ${result.authorized ? "yes" : "no"}`],
          steps: [
            `Open ${ctx.origin} and check the certificate and protocol.`,
            `The handshake used ${result.protocol || "an unknown protocol"} and trusted certificate ${result.authorized ? "yes" : "no"}.`,
            "Require TLS 1.2 or newer and a current trusted certificate.",
          ],
        }),
      );
    }
  } catch {
    if (home) {
      ctx.add(
        "weak_tls",
        "The HTTPS endpoint did not complete a trusted TLS handshake.",
        ctx.detailFor(home, {
          steps: [
            `Open ${ctx.origin}.`,
            "The handshake did not finish with a trusted certificate.",
            "Install a current certificate and allow TLS 1.2 or newer.",
          ],
        }),
      );
    }
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

function redactCookieFlags(cookie: string): string {
  const [pair, ...attrs] = cookie.split(";");
  const name = pair.split("=")[0]?.trim() || "cookie";
  return [`${name}=[redacted]`, ...attrs.map((part) => part.trim())].filter(Boolean).join("; ");
}

function cookieIsHardened(cookie: string): boolean {
  const parts = cookie.split(";").map((part) => part.trim().toLowerCase());
  const httpOnly = parts.includes("httponly");
  const secure = parts.includes("secure");
  const sameSite = parts.some((part) => part.startsWith("samesite="));
  return httpOnly && secure && sameSite;
}
