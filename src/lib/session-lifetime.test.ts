import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  MAGIC_LINK_EXPIRED_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  SESSION_EXPIRY_NOTICE_SECONDS,
  SESSION_MAX_AGE_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
  classifySession,
  cookieMaxAgeForExpiry,
  loginPageError,
  safeReturnPath,
  sessionCookieOptions,
  sessionExpiresAt,
  sessionExpiryAfterActivity,
  sessionExpiryCookieOptions,
  sessionExpiryCookieValue,
} from "./session-lifetime";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

test("new sessions last 3 hours and the cookie expires with the row", () => {
  assert.equal(SESSION_MAX_AGE_SECONDS, 3 * 60 * 60);
  assert.equal(SESSION_UPDATE_AGE_SECONDS, SESSION_MAX_AGE_SECONDS);
  const now = Date.parse("2026-11-04T12:00:00.000Z");
  const expiresAt = sessionExpiresAt(new Date(now));
  assert.equal(expiresAt.getTime() - now, SESSION_MAX_AGE_SECONDS * 1000);
  assert.equal(cookieMaxAgeForExpiry(expiresAt, now), SESSION_MAX_AGE_SECONDS);
  const cookie = sessionCookieOptions(expiresAt, now, "https://scan.example");
  assert.equal(cookie.maxAge, SESSION_MAX_AGE_SECONDS);
  assert.equal(cookie.expires.getTime(), expiresAt.getTime());
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.secure, true);
  assert.equal(cookie.path, "/");
  const notice = sessionExpiryCookieOptions(expiresAt, now, "http://localhost:3000");
  assert.equal(notice.expires.getTime(), expiresAt.getTime() + SESSION_EXPIRY_NOTICE_SECONDS * 1000);
  assert.equal(notice.maxAge, SESSION_MAX_AGE_SECONDS + SESSION_EXPIRY_NOTICE_SECONDS);
  assert.equal(notice.secure, false);
  assert.equal(sessionExpiryCookieValue(expiresAt), String(expiresAt.getTime()));
});

test("activity does not extend a session past sign-in", () => {
  const createdAt = new Date("2026-11-04T12:00:00.000Z");
  const expiresAt = sessionExpiresAt(createdAt);
  const halfway = createdAt.getTime() + 90 * 60 * 1000;
  assert.equal(sessionExpiryAfterActivity({ createdAt, expiresAt, now: halfway }).getTime(), expiresAt.getTime());
  const almostDone = expiresAt.getTime() - 1000;
  assert.equal(sessionExpiryAfterActivity({ createdAt, expiresAt, now: almostDone }).getTime(), expiresAt.getTime());
  const after = expiresAt.getTime() + 60_000;
  assert.ok(sessionExpiryAfterActivity({ createdAt, expiresAt, now: after }).getTime() <= expiresAt.getTime());
});

test("sessions issued before the 3-hour cap stay valid until their stored expiry", () => {
  const createdAt = new Date("2026-10-01T00:00:00.000Z");
  const expiresAt = new Date("2026-10-31T00:00:00.000Z");
  const now = Date.parse("2026-10-20T00:00:00.000Z");
  assert.equal(sessionExpiryAfterActivity({ createdAt, expiresAt, now }).getTime(), expiresAt.getTime());
  assert.equal(classifySession({ hasSessionCookie: true, expiresAt, now }), "active");
  assert.equal(classifySession({ hasSessionCookie: true, expiresAt, expiryCookie: String(createdAt.getTime()), now }), "active");
});

test("an elapsed session is expired, and a signed-out visitor is anonymous", () => {
  const now = Date.parse("2026-11-04T15:00:00.000Z");
  const ended = new Date(now - 1000);
  const future = new Date(now + 60_000);
  assert.equal(classifySession({ hasSessionCookie: true, expiresAt: ended, now }), "expired");
  assert.equal(classifySession({ hasSessionCookie: true, expiresAt: null, now }), "expired");
  assert.equal(classifySession({ hasSessionCookie: false, expiresAt: null, expiryCookie: String(ended.getTime()), now }), "expired");
  assert.equal(classifySession({ hasSessionCookie: false, expiresAt: null, expiryCookie: String(future.getTime()), now }), "anonymous");
  assert.equal(classifySession({ hasSessionCookie: false, expiresAt: null, now }), "anonymous");
  assert.equal(classifySession({ hasSessionCookie: true, expiresAt: future, now }), "active");
});

test("the sign-in page explains an ended session and still explains a dead magic link", () => {
  assert.equal(SESSION_EXPIRED_MESSAGE, "Your session expired, please sign in again.");
  assert.equal(loginPageError("session", "anonymous"), SESSION_EXPIRED_MESSAGE);
  assert.equal(loginPageError(undefined, "expired"), SESSION_EXPIRED_MESSAGE);
  assert.equal(loginPageError("expired", "expired"), MAGIC_LINK_EXPIRED_MESSAGE);
  assert.equal(loginPageError(undefined, "anonymous"), undefined);
  assert.equal(safeReturnPath("/scans/scan_1?checkout=report#upgrade"), "/scans/scan_1?checkout=report#upgrade");
  assert.equal(safeReturnPath("/check?url=https://app.example"), "/check?url=https://app.example");
  assert.equal(safeReturnPath("https://evil.example"), "/dashboard");
  assert.equal(safeReturnPath("//evil.example"), "/dashboard");
});

test("sign-in writes a fixed expiry and later requests do not refresh it", () => {
  const auth = read("src/lib/auth.ts");
  const verify = read("src/app/api/auth/verify/route.ts");
  assert.match(auth, /sessionExpiresAt\(createdAt\)/);
  assert.match(auth, /expiresAt,/);
  assert.doesNotMatch(auth, /prisma\.session\.update/);
  assert.doesNotMatch(auth, /jar\.set/);
  assert.match(auth, /jar\.delete\(SESSION_EXPIRY_COOKIE\)/);
  assert.match(verify, /sessionCookieOptions\(session\.expiresAt\)/);
  assert.match(verify, /sessionExpiryCookieOptions\(session\.expiresAt\)/);
  assert.match(verify, /sessionExpiryCookieValue\(session\.expiresAt\)/);
});

test("protected pages send an ended session to sign-in and back to the same page", () => {
  assert.match(read("src/app/dashboard/page.tsx"), /requirePageUser\("\/dashboard"\)/);
  assert.match(read("src/app/scans/new/page.tsx"), /requirePageUser\(returnPath\)/);
  assert.match(read("src/app/scans/[id]/page.tsx"), /requirePageUser\(scanPageReturnPath\(id, query\.checkout\)\)/);
  assert.match(read("src/app/check/page.tsx"), /requirePageUser\(/);
  assert.match(read("src/app/pricing/page.tsx"), /signInPath\(pricingCheckoutPath\(tier\), \{ expired: true \}\)/);
  assert.match(read("src/app/login/page.tsx"), /loginPageError/);
  assert.match(read("src/lib/require-user.ts"), /expired: session\.status === "expired"/);
  assert.match(read("src/components/ScanPoller.tsx"), /status === 401/);
  assert.match(read("src/components/ScanPoller.tsx"), /expired: true/);
  assert.doesNotMatch(read("src/components/ScanPoller.tsx"), /\/cancel|abortScan|deleteScan/);
  assert.match(read("src/components/UpgradePanel.tsx"), /expired: true/);
});

test("API routes return 401 without a session, and scans and payment webhooks do not need one", () => {
  const delegated: Record<string, string> = {
    "src/app/api/checkout/route.ts": "src/lib/payments/index.ts",
    "src/app/api/stripe/checkout/route.ts": "src/lib/payments/index.ts",
    "src/app/api/scans/[id]/pdf/route.ts": "src/lib/paid-scan.ts",
    "src/app/api/scans/[id]/print/route.ts": "src/lib/paid-scan.ts",
    "src/app/api/scans/[id]/markdown/route.ts": "src/lib/paid-scan.ts",
  };
  const protectedRoutes = [
    "src/app/api/billing/cancel/route.ts",
    "src/app/api/checkout/route.ts",
    "src/app/api/stripe/checkout/route.ts",
    "src/app/api/github/connect/route.ts",
    "src/app/api/github/select/route.ts",
    "src/app/api/projects/route.ts",
    "src/app/api/projects/[id]/code-scan/route.ts",
    "src/app/api/projects/[id]/demo-proof/route.ts",
    "src/app/api/projects/[id]/monitor/route.ts",
    "src/app/api/projects/[id]/verify/route.ts",
    "src/app/api/purchases/[id]/retry/route.ts",
    "src/app/api/scans/[id]/code-choice/route.ts",
    "src/app/api/scans/[id]/markdown/route.ts",
    "src/app/api/scans/[id]/pdf/route.ts",
    "src/app/api/scans/[id]/print/route.ts",
    "src/app/api/scans/[id]/retry/route.ts",
    "src/app/api/scans/[id]/route.ts",
    "src/app/api/scans/[id]/share/route.ts",
  ];
  for (const route of protectedRoutes) {
    const source = read(delegated[route] ?? route);
    assert.match(source, /status:\s*401|status === 401/, route);
    assert.match(`${read(route)}\n${source}`, /getCurrentUser|requirePaidScan|checkoutResponse/, route);
  }
  for (const open of [
    "src/app/api/health/route.ts",
    "src/app/api/badge/[token]/route.ts",
    "src/app/api/dodo/webhook/route.ts",
    "src/app/api/stripe/webhook/route.ts",
    "src/app/api/github/webhook/route.ts",
    "src/worker/index.ts",
    "src/worker/execute.ts",
    "src/worker/run-scan.ts",
  ]) {
    assert.doesNotMatch(read(open), /getCurrentUser|requirePageUser|readSession/, open);
  }
  const expired = read("src/app/api/auth/expired/route.ts");
  assert.match(expired, /SESSION_EXPIRED_CODE/);
  assert.match(expired, /status === "active"/);
  assert.doesNotMatch(read("src/lib/payments/webhook.ts"), /getCurrentUser|readSession/);
});
