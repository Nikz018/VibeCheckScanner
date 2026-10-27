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
    const pages = ctx.pages.length > 0 ? ctx.pages : [home];
    const cors = ctx.corsProbe ?? home;

    const missingCsp = pages.filter((page) => !cspHeader(page));
    ctx.mark("missing_csp");
    if (missingCsp.length > 0) {
      addForPages(
        ctx,
        "missing_csp",
        `${pagePhrase(missingCsp.length)} did not include a Content-Security-Policy header.`,
        missingCsp,
        "The response headers do not include Content-Security-Policy.",
        "Send a policy that limits scripts to your origin.",
      );
    }

    const https = ctx.origin.startsWith("https:");
    const missingHsts = https ? pages.filter((page) => !page.headers["strict-transport-security"]) : [];
    ctx.mark("missing_hsts");
    if (missingHsts.length > 0) {
      addForPages(
        ctx,
        "missing_hsts",
        `${pagePhrase(missingHsts.length)} did not include a Strict-Transport-Security header.`,
        missingHsts,
        "The response headers do not include Strict-Transport-Security.",
        "Send HSTS on HTTPS responses.",
      );
    }

    const missingFrame = pages.filter((page) => {
      const framed = page.headers["x-frame-options"] || /frame-ancestors/i.test(cspHeader(page));
      return !framed;
    });
    ctx.mark("missing_frame_protection");
    if (missingFrame.length > 0) {
      addForPages(
        ctx,
        "missing_frame_protection",
        `${pagePhrase(missingFrame.length)} did not send X-Frame-Options or a CSP frame-ancestors directive.`,
        missingFrame,
        "The response can be embedded in a frame.",
        "Send frame-ancestors 'none' or X-Frame-Options: DENY.",
      );
    }

    const missingNosniff = pages.filter((page) => page.headers["x-content-type-options"]?.toLowerCase() !== "nosniff");
    ctx.mark("missing_content_type_options");
    if (missingNosniff.length > 0) {
      addForPages(
        ctx,
        "missing_content_type_options",
        `${pagePhrase(missingNosniff.length)} did not send X-Content-Type-Options: nosniff.`,
        missingNosniff,
        "The response headers do not include X-Content-Type-Options: nosniff.",
      );
    }

    const missingReferrer = pages.filter((page) => !page.headers["referrer-policy"]);
    ctx.mark("missing_referrer_policy");
    if (missingReferrer.length > 0) {
      addForPages(
        ctx,
        "missing_referrer_policy",
        `${pagePhrase(missingReferrer.length)} did not send a Referrer-Policy header.`,
        missingReferrer,
        "The response headers do not include Referrer-Policy.",
      );
    }

    ctx.mark("cors_credential_wildcard");
    const corsHeaders = lowerHeaders(cors.headers);
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
        undefined,
        [cors.url],
      );
    }

    const weakPages = pages.flatMap((page) => {
      const weak = page.setCookies.filter((cookie) => !cookieIsHardened(cookie));
      return weak.length > 0 ? [{ page, weak }] : [];
    });
    ctx.mark("insecure_cookies");
    if (weakPages.length > 0) {
      const names = [...new Set(weakPages.flatMap((entry) => entry.weak.map(cookieName)))].slice(0, 4).join(", ");
      const shown = weakPages[0].weak.slice(0, 4).map(redactCookieFlags);
      const affected = weakPages.map((entry) => entry.page.url);
      ctx.add(
        "insecure_cookies",
        `Cookie ${names} is missing HttpOnly, Secure, or SameSite.`,
        ctx.detailFor(weakPages[0].page, {
          requestHeaders: { accept: "text/html" },
          locations: weakPages.slice(0, 6).map((entry) => ({ method: "GET", url: entry.page.url })),
          snippetLines: shown.map((cookie) => `set-cookie: ${cookie}`),
          steps: reproduce("GET", weakPages[0].page.url, `Set-Cookie for ${names} is missing HttpOnly, Secure, or SameSite.`),
        }),
        undefined,
        affected,
      );
    }

    ctx.mark("weak_tls");
    await inspectTransport(ctx);
  });
}

function cspHeader(page: ProbeResponse): string {
  return page.headers["content-security-policy"] || page.headers["content-security-policy-report-only"] || "";
}

function pagePhrase(count: number): string {
  return `${count} scanned ${count === 1 ? "page" : "pages"}`;
}

function addForPages(
  ctx: ScanContext,
  checkId: string,
  evidence: string,
  pages: ProbeResponse[],
  saw: string,
  next?: string,
): void {
  const first = pages[0];
  ctx.add(
    checkId,
    evidence,
    ctx.detailFor(first, {
      requestHeaders: { accept: "text/html" },
      locations: pages.slice(0, 6).map((page) => ({ method: "GET", url: page.url })),
      steps: reproduce("GET", first.url, saw, next),
    }),
    undefined,
    pages.map((page) => page.url),
  );
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
