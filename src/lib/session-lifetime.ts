/**
 * Login sessions are an absolute 3 hours from sign-in.
 * Activity must not move Session.expiresAt or the vc_session cookie.
 * updateAge equals maxAge, which is the Auth.js way to skip sliding refresh:
 * a refresh is only considered once the session is already at its cap, and
 * sessionExpiryAfterActivity never returns a later time than the stored expiry.
 * Rows created before this cap keep the expiresAt they were issued with.
 */
export const SESSION_MAX_AGE_SECONDS = 3 * 60 * 60;
export const SESSION_UPDATE_AGE_SECONDS = SESSION_MAX_AGE_SECONDS;

export const SESSION_COOKIE = "vc_session";
/**
 * Not a credential. Stores the session's expiresAt (unix ms) so a protected
 * page can explain the ended session after the browser drops vc_session.
 * vc_session itself expires at the same instant as the database row.
 */
export const SESSION_EXPIRY_COOKIE = "vc_session_exp";
export const SESSION_EXPIRY_NOTICE_SECONDS = 24 * 60 * 60;

export const SESSION_EXPIRED_CODE = "session";
export const SESSION_EXPIRED_MESSAGE = "Your session expired, please sign in again.";
export const MAGIC_LINK_EXPIRED_MESSAGE = "That sign-in link expired. Request a new one.";

export function sessionExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
}

export function cookieMaxAgeForExpiry(expiresAt: Date, now = Date.now()): number {
  const deltaMs = expiresAt.getTime() - now;
  if (deltaMs <= 0) return 0;
  return Math.ceil(deltaMs / 1000);
}

export type SessionCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
  expires: Date;
};

export function appCookieSecure(appUrl = process.env.APP_URL || ""): boolean {
  return appUrl.startsWith("https://");
}

export function sessionCookieOptions(expiresAt: Date, now = Date.now(), appUrl = process.env.APP_URL || ""): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: appCookieSecure(appUrl),
    path: "/",
    maxAge: cookieMaxAgeForExpiry(expiresAt, now),
    expires: expiresAt,
  };
}

export function sessionExpiryCookieOptions(expiresAt: Date, now = Date.now(), appUrl = process.env.APP_URL || ""): SessionCookieOptions {
  const noticeExpires = new Date(expiresAt.getTime() + SESSION_EXPIRY_NOTICE_SECONDS * 1000);
  return sessionCookieOptions(noticeExpires, now, appUrl);
}

export function sessionExpiryCookieValue(expiresAt: Date): string {
  return String(expiresAt.getTime());
}

/**
 * Returns the expiry to store after activity. Never later than the expiry
 * already stored. Sessions issued with a longer expiresAt (before the 3-hour
 * cap) are returned unchanged so they keep working until that time.
 */
export function sessionExpiryAfterActivity(input: { createdAt: Date; expiresAt: Date; now?: number }): Date {
  const now = input.now ?? Date.now();
  const maxAgeMs = SESSION_MAX_AGE_SECONDS * 1000;
  const updateAgeMs = SESSION_UPDATE_AGE_SECONDS * 1000;
  const absoluteEnd = input.createdAt.getTime() + maxAgeMs;
  if (input.expiresAt.getTime() > absoluteEnd) return input.expiresAt;
  if (now - input.createdAt.getTime() < updateAgeMs) return input.expiresAt;
  const slid = Math.min(now + maxAgeMs, absoluteEnd, input.expiresAt.getTime());
  return new Date(slid);
}

export function expiryNoticeElapsed(value: string | undefined, now = Date.now()): boolean {
  if (!value || !/^\d{10,16}$/.test(value)) return false;
  const expiry = Number(value);
  return Number.isFinite(expiry) && expiry <= now;
}

export type SessionAccess = "anonymous" | "active" | "expired";

export function classifySession(input: {
  hasSessionCookie: boolean;
  expiresAt: Date | null;
  expiryCookie?: string;
  now?: number;
}): SessionAccess {
  const now = input.now ?? Date.now();
  if (input.hasSessionCookie && input.expiresAt && input.expiresAt.getTime() > now) return "active";
  if (input.hasSessionCookie) return "expired";
  if (expiryNoticeElapsed(input.expiryCookie, now)) return "expired";
  return "anonymous";
}

export function safeReturnPath(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value) return fallback;
  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return fallback;
  if (/[\u0000-\u001f]/.test(path)) return fallback;
  const pathOnly = path.split("?")[0]?.split("#")[0] ?? path;
  if (pathOnly.includes("://")) return fallback;
  return path.slice(0, 500);
}

export function loginPageError(error: string | undefined, sessionStatus: SessionAccess): string | undefined {
  if (error === "expired") return MAGIC_LINK_EXPIRED_MESSAGE;
  if (error === SESSION_EXPIRED_CODE || sessionStatus === "expired") return SESSION_EXPIRED_MESSAGE;
  return undefined;
}
