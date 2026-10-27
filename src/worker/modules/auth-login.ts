import { safeFetch, type ProbeResponse } from "@/lib/http";
import type { AuthAccount } from "@/lib/auth-input";
import { scannerUserAgent } from "@/lib/scanner-identity";
import { withTargetPace } from "@/lib/target-pace";
import { assertLoginPost, assertReadOnlyMethod, isActionUrl } from "../readonly";
import type { ScanContext } from "../context";

export interface AuthSession {
  label: "A" | "B";
  cookieHeader: string;
  bearer: string | null;
  setCookies: string[];
  loginUrl: string;
  startUrl: string;
}

export interface CapturedCall {
  label: "A" | "B";
  method: "GET" | "HEAD";
  url: string;
  status: number;
  body: string;
  contentType: string;
  setCookies: string[];
}

const AUTH_BUDGET_MS = 20_000;

export async function establishSession(ctx: ScanContext, account: AuthAccount): Promise<AuthSession | null> {
  ctx.rememberSecret(account.password);
  ctx.rememberSecret(account.cookie);
  ctx.rememberSecret(account.bearerToken);
  if (account.cookie || account.bearerToken) {
    const session: AuthSession = {
      label: account.label,
      cookieHeader: account.cookie,
      bearer: account.bearerToken || null,
      setCookies: account.cookie ? [account.cookie.includes("=") ? account.cookie : `session=${account.cookie}`] : [],
      loginUrl: account.loginUrl,
      startUrl: ctx.origin,
    };
    rememberSession(ctx, session);
    return session;
  }
  if (!account.username || !account.password) return null;
  const browserSession = await loginWithBrowser(ctx, account);
  if (browserSession) return browserSession;
  return loginWithForm(ctx, account);
}

export async function readOnlyGet(ctx: ScanContext, url: string, session: AuthSession): Promise<ProbeResponse> {
  assertReadOnlyMethod("GET");
  if (isActionUrl(url)) {
    return { url, status: 0, headers: {}, setCookies: [], body: "", location: null };
  }
  const headers: Record<string, string> = { accept: "*/*" };
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { url, status: 0, headers: {}, setCookies: [], body: "", location: null };
  }
  if (target.origin === ctx.origin && session.cookieHeader) headers.cookie = session.cookieHeader;
  if (session.bearer) headers.authorization = `Bearer ${session.bearer}`;
  const response = await ctx.fetch(url, { method: "GET", headers, follow: true, maxBytes: 120_000 });
  for (const cookie of response.setCookies) ctx.rememberSecret(cookieValue(cookie));
  const bearer = bearerFromBody(response.body, response.headers["content-type"] || "");
  if (bearer) ctx.rememberSecret(bearer);
  return response;
}

async function loginWithForm(ctx: ScanContext, account: AuthAccount): Promise<AuthSession | null> {
  let page: ProbeResponse;
  try {
    assertReadOnlyMethod("GET");
    page = await ctx.fetch(account.loginUrl, { headers: { accept: "text/html" }, follow: true, maxBytes: 120_000 });
  } catch {
    return null;
  }
  const form = parseLoginForm(page.body, page.url || account.loginUrl);
  const action = form?.action || account.loginUrl;
  const body = form
    ? encodeForm({ ...form.hidden, [form.userField]: account.username, [form.passField]: account.password })
    : encodeForm({ email: account.username, username: account.username, password: account.password });
  try {
    assertLoginPost("POST", action, [account.loginUrl, action]);
  } catch {
    return null;
  }
  let posted: ProbeResponse;
  try {
    posted = await safeFetch({
      url: action,
      targetOrigin: ctx.origin,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html, application/json" },
      body,
      follow: false,
      maxBytes: 80_000,
    });
  } catch {
    return null;
  }
  const jar = new Map<string, string>();
  absorbCookies(jar, posted.setCookies);
  const bearer = bearerFromBody(posted.body, posted.headers["content-type"] || "");
  if (bearer) ctx.rememberSecret(bearer);
  for (const value of jar.values()) ctx.rememberSecret(value);
  const moved = posted.status >= 300 && posted.status < 400 && Boolean(posted.location);
  if (jar.size === 0 && !bearer && !moved) return null;
  if (jar.size === 0 && !bearer && isDenied(posted.body)) return null;
  let startUrl = ctx.origin;
  if (posted.location) {
    try {
      const next = new URL(posted.location, action);
      if (next.origin === ctx.origin && !isActionUrl(next.toString())) startUrl = next.toString();
    } catch {
      startUrl = ctx.origin;
    }
  }
  const session: AuthSession = {
    label: account.label,
    cookieHeader: cookieHeader(jar),
    bearer,
    setCookies: posted.setCookies,
    loginUrl: account.loginUrl,
    startUrl,
  };
  rememberSession(ctx, session);
  return session.cookieHeader || session.bearer ? session : null;
}

function rememberSession(ctx: ScanContext, session: AuthSession): void {
  ctx.rememberSecret(session.cookieHeader);
  ctx.rememberSecret(session.bearer);
  for (const cookie of session.setCookies) ctx.rememberSecret(cookieValue(cookie));
}

async function loginWithBrowser(ctx: ScanContext, account: AuthAccount): Promise<AuthSession | null> {
  if (process.env.PLAYWRIGHT_ENABLED === "false") return null;
  const budget = Math.min(browserBudgetMs(), AUTH_BUDGET_MS);
  let browser: import("playwright").Browser | null = null;
  const started = Date.now();
  try {
    const playwright = await import("playwright");
    const channel = process.env.PLAYWRIGHT_CHANNEL?.trim();
    browser = await playwright.chromium.launch({
      headless: true,
      timeout: Math.min(8000, budget),
      ...(channel ? { channel: channel as "chrome" } : {}),
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({ userAgent: scannerUserAgent() });
    const page = await context.newPage();
    let posts = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      const method = request.method().toUpperCase();
      let url: URL;
      try {
        url = new URL(request.url());
      } catch {
        await route.abort();
        return;
      }
      if (url.origin !== ctx.origin) {
        await route.abort();
        return;
      }
      if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
        if (isActionUrl(request.url())) {
          await route.abort();
          return;
        }
        await route.continue();
        return;
      }
      if (method === "POST" && posts < 1 && !isActionUrl(request.url())) {
        posts += 1;
        await route.continue();
        return;
      }
      await route.abort();
    });
    const remaining = Math.max(1000, budget - (Date.now() - started));
    page.setDefaultTimeout(remaining);
    await withTargetPace(account.loginUrl, () => page.goto(account.loginUrl, { waitUntil: "domcontentloaded", timeout: remaining }));
    const email = page.locator('input[type="email"], input[name="email" i], input[name="username" i], input[autocomplete="username" i]').first();
    const password = page.locator('input[type="password"]').first();
    if ((await email.count()) === 0 || (await password.count()) === 0) return null;
    await email.fill(account.username);
    await password.fill(account.password);
    const submit = page.locator('button[type="submit"], input[type="submit"]').first();
    if ((await submit.count()) > 0) await submit.click();
    else await password.press("Enter");
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => undefined);
    const cookies = await context.cookies(ctx.origin);
    const jar = new Map<string, string>();
    const setCookies: string[] = [];
    for (const cookie of cookies) {
      if (!cookie.name || !cookie.value) continue;
      jar.set(cookie.name, cookie.value);
      ctx.rememberSecret(cookie.value);
      const parts = [`${cookie.name}=${cookie.value}`];
      if (cookie.httpOnly) parts.push("HttpOnly");
      if (cookie.secure) parts.push("Secure");
      if (cookie.sameSite === "Lax" || cookie.sameSite === "Strict") parts.push(`SameSite=${cookie.sameSite}`);
      setCookies.push(parts.join("; "));
    }
    const stored = await page.evaluate(() => {
      const values: string[] = [];
      for (const store of [window.localStorage, window.sessionStorage]) {
        for (let index = 0; index < store.length; index += 1) {
          const key = store.key(index);
          const value = key ? store.getItem(key) : null;
          if (value) values.push(value);
        }
      }
      return values;
    });
    let bearer: string | null = null;
    for (const value of stored) {
      ctx.rememberSecret(value);
      bearer = bearer || bearerFromText(value);
    }
    if (bearer) ctx.rememberSecret(bearer);
    const current = page.url();
    let moved = false;
    try {
      moved = new URL(current).pathname !== new URL(account.loginUrl).pathname;
    } catch {
      moved = false;
    }
    const stillPassword = (await password.count()) > 0 && (await password.isVisible().catch(() => false));
    if (!jar.size && !bearer) return null;
    if (!moved && stillPassword && !bearer) return null;
    const session: AuthSession = {
      label: account.label,
      cookieHeader: cookieHeader(jar),
      bearer,
      setCookies,
      loginUrl: account.loginUrl,
      startUrl: moved ? current : ctx.origin,
    };
    rememberSession(ctx, session);
    return session;
  } catch (error) {
    console.warn(`browser sign-in unavailable: ${error instanceof Error ? error.name : "error"}`);
    return null;
  } finally {
    await Promise.race([browser?.close().catch(() => undefined) ?? Promise.resolve(), new Promise<void>((resolve) => setTimeout(resolve, 2000))]);
  }
}

function browserBudgetMs(): number {
  const raw = Number(process.env.BROWSER_TIMEOUT_MS || 20000);
  return Number.isFinite(raw) && raw >= 3000 ? raw : 20000;
}

export function parseLoginForm(html: string, pageUrl: string): { action: string; userField: string; passField: string; hidden: Record<string, string> } | null {
  const form = html.match(/<form\b[^>]*>[\s\S]*?<\/form>/i);
  if (!form) return null;
  const tag = form[0].match(/<form\b[^>]*>/i)?.[0] ?? "";
  const actionAttr = /action=["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
  let action = pageUrl;
  try {
    action = new URL(actionAttr || pageUrl, pageUrl).toString();
  } catch {
    action = pageUrl;
  }
  const hidden: Record<string, string> = {};
  let userField = "";
  let passField = "";
  for (const input of form[0].match(/<input\b[^>]*>/gi) ?? []) {
    const name = /name=["']([^"']+)["']/i.exec(input)?.[1] ?? "";
    const type = (/type=["']([^"']+)["']/i.exec(input)?.[1] ?? "text").toLowerCase();
    const value = /value=["']([^"']*)["']/i.exec(input)?.[1] ?? "";
    if (!name) continue;
    if (type === "hidden") hidden[name] = value;
    if (!passField && type === "password") passField = name;
    if (!userField && (type === "email" || /email|user/i.test(name))) userField = name;
  }
  if (!userField || !passField) return null;
  return { action, userField, passField, hidden };
}

function encodeForm(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function absorbCookies(jar: Map<string, string>, setCookies: string[]): void {
  for (const raw of setCookies) {
    const pair = raw.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!name) continue;
    if (!value) jar.delete(name);
    else jar.set(name, value);
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function cookieValue(setCookie: string): string {
  const pair = setCookie.split(";")[0] ?? "";
  const eq = pair.indexOf("=");
  return eq >= 0 ? pair.slice(eq + 1).trim() : "";
}

export function bearerFromBody(body: string, contentType: string): string | null {
  if (!contentType.includes("json") && !body.trim().startsWith("{")) return bearerFromText(body);
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    for (const key of ["token", "access_token", "accessToken", "jwt", "idToken"]) {
      const value = parsed[key];
      if (typeof value === "string" && value.length >= 8) return value;
    }
  } catch {
    return bearerFromText(body);
  }
  return bearerFromText(body);
}

function bearerFromText(text: string): string | null {
  const named = text.match(/"(?:access_token|token|jwt)"\s*:\s*"([^"]{8,})"/);
  if (named) return named[1];
  const jwt = text.match(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/);
  return jwt ? jwt[0] : null;
}

function isDenied(body: string): boolean {
  return /<input[^>]+type=["']password["']/i.test(body) && /log in|sign in/i.test(body);
}
