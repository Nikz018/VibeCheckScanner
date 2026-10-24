import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { isIP } from "node:net";
import { ProbeBlockedError, originOf, safeFetch } from "./http";

export const CONSENT_TEXT =
  "I confirm I own or am authorized to test this application, and I agree to a non-destructive security scan of this origin. I understand the result is a point-in-time report, not a guarantee or a compliance certification.";

export function newOwnershipToken(): string {
  return `vc_${randomBytes(16).toString("hex")}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function proofMatches(body: string, token: string): boolean {
  const got = Buffer.from(body.replace(/^\uFEFF/, "").trim());
  const expected = Buffer.from(token.trim());
  if (got.length !== expected.length || got.length === 0) return false;
  return timingSafeEqual(got, expected);
}

export interface OwnershipInstructions {
  token: string;
  wellKnownPath: string;
  wellKnownUrl: string;
  dnsHost: string;
  dnsName: string;
  dnsValue: string;
}

export function instructionsFor(targetUrl: string, token: string): OwnershipInstructions {
  const url = new URL(targetUrl);
  return {
    token,
    wellKnownPath: "/.well-known/vibecheck-verify.txt",
    wellKnownUrl: `${url.origin}/.well-known/vibecheck-verify.txt`,
    dnsHost: url.hostname,
    dnsName: url.hostname,
    dnsValue: token,
  };
}

export async function verifyOwnership(targetUrl: string, token: string): Promise<{ ok: boolean; method?: "well_known" | "dns_txt"; reason?: string }> {
  let origin: string;
  try {
    origin = originOf(targetUrl);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Invalid URL" };
  }

  try {
    const file = await safeFetch({
      url: `${origin}/.well-known/vibecheck-verify.txt`,
      targetOrigin: origin,
      method: "GET",
      follow: false,
      timeoutMs: 6000,
      maxBytes: 400,
    });
    if (file.status === 200 && proofMatches(file.body, token)) {
      return { ok: true, method: "well_known" };
    }
  } catch (error) {
    if (error instanceof ProbeBlockedError) {
      return { ok: false, reason: error.message };
    }
  }

  const host = new URL(origin).hostname;
  if (!isIP(host) && host !== "localhost") {
    const names = [host, `_vibecheck.${host}`];
    for (const name of names) {
      try {
        const records = await resolveTxt(name);
        const values = records.map((chunks) => chunks.join(""));
        if (values.some((record) => record.includes(token))) {
          return { ok: true, method: "dns_txt" };
        }
      } catch {
        // NXDOMAIN is a normal miss.
      }
    }
  }

  return {
    ok: false,
    reason: "Ownership proof was not found. Publish the token in DNS TXT or at /.well-known/vibecheck-verify.txt and try again.",
  };
}

export function assertConsent(consent: boolean): void {
  if (consent !== true) {
    throw new Error("Consent is required before a scan can start");
  }
}

export const DEMO_PORTS = new Set([4010, 4011, 4012]);

export function isLocalDemoUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return local && DEMO_PORTS.has(port);
  } catch {
    return false;
  }
}
