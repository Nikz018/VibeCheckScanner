import type { AuthScanPayload } from "@/lib/auth-input";
import { reproduce } from "@/lib/finding-detail";
import { LOGIN_FAILED_NOTICE, LOGIN_NOT_INCLUDED_NOTICE } from "@/lib/limitations";
import type { Confidence } from "@/lib/report";
import {
  crossAccountLeak,
  extractMarkers,
  findJwts,
  idsInUrl,
  inspectCookieFlags,
  inspectJwt,
  isObjectFetch,
  isPrivilegedResponse,
  markerList,
  otherUserEmails,
  paywallBypass,
  readPlan,
  readRole,
  swapUrlId,
  swappedIdLeak,
} from "./auth-compare";
import { establishSession, readOnlyGet, type AuthSession, type CapturedCall } from "./auth-login";
import { isActionUrl } from "../readonly";
import { runModule, type ScanContext } from "../context";

export const AUTHENTICATED_CHECK_IDS = [
  "auth_idor_bola",
  "auth_vertical_privilege",
  "auth_paywall_bypass",
  "auth_sensitive_exposure",
  "auth_session_weakness",
  "auth_backend_cross_user",
] as const;

const LIMITS = { maxPages: 8, maxRequests: 70, maxMs: 25_000, delayMs: 100 };
const EXTRA_PATHS = [
  "/api/me",
  "/api/user",
  "/api/profile",
  "/admin",
  "/api/admin",
  "/api/admin/users",
  "/premium",
  "/api/premium",
  "/api/pro",
  "/rest/v1/users?select=id,email&limit=5",
  "/rtdb/users.json",
  "/rtdb/.json",
];

export async function runAuthenticated(ctx: ScanContext, auth: AuthScanPayload | null): Promise<void> {
  if (!auth) {
    skipAuthenticated(ctx, LOGIN_NOT_INCLUDED_NOTICE);
    return;
  }
  for (const account of auth.accounts) {
    ctx.rememberSecret(account.password);
    ctx.rememberSecret(account.cookie);
    ctx.rememberSecret(account.bearerToken);
  }
  await runModule([...AUTHENTICATED_CHECK_IDS], ctx, async () => {
    const sessions: AuthSession[] = [];
    const failed: string[] = [];
    for (const account of auth.accounts) {
      const session = await establishSession(ctx, account);
      if (session) sessions.push(session);
      else failed.push(account.label);
    }
    if (sessions.length === 0) {
      skipAuthenticated(ctx, LOGIN_FAILED_NOTICE);
      return;
    }
    if (failed.length > 0) {
      ctx.note(
        `Logged-in checks for account ${failed.join(" and ")} were skipped: login failed. The other signed-in checks still ran, and unauthenticated checks still ran.`,
      );
    }
    const captured: CapturedCall[] = [];
    const budget = { requests: 0, started: Date.now() };
    for (const session of sessions) {
      await crawlSession(ctx, session, captured, budget);
    }
    if (!sawAuthenticatedData(captured)) {
      skipAuthenticated(ctx, LOGIN_FAILED_NOTICE);
      return;
    }
    await runIdor(ctx, sessions, captured, budget);
    runVertical(ctx, captured);
    runPaywall(ctx, captured);
    runSensitive(ctx, captured);
    runSession(ctx, sessions, captured);
    await runBackend(ctx, sessions, captured, budget);
  });
}

export function skipAuthenticated(ctx: ScanContext, notice: string): void {
  for (const id of AUTHENTICATED_CHECK_IDS) ctx.setMark(id, "skipped");
  ctx.note(notice);
}

async function crawlSession(ctx: ScanContext, session: AuthSession, captured: CapturedCall[], budget: Budget): Promise<void> {
  const queue = [session.startUrl, ctx.origin];
  const seen = new Set<string>();
  let pages = 0;
  while (queue.length > 0 && pages < LIMITS.maxPages && budget.requests < LIMITS.maxRequests && Date.now() - budget.started < LIMITS.maxMs) {
    const url = queue.shift();
    if (!url || seen.has(url) || !sameOrigin(url, ctx.origin) || isActionUrl(url)) continue;
    seen.add(url);
    const response = await timedGet(ctx, url, session, budget);
    if (!response) continue;
    captured.push(toCall(session, response));
    const type = response.headers["content-type"] || "";
    if (type.includes("html") || response.body.includes("<a ") || response.body.includes("<script")) {
      pages += 1;
      for (const link of extractSameOriginLinks(response.body, response.url, ctx.origin)) {
        if (!seen.has(link)) queue.push(link);
      }
      const bearer = findJwts(response.body)[0];
      if (bearer && !session.bearer) {
        session.bearer = bearer;
        ctx.rememberSecret(bearer);
      }
    }
  }
  for (const path of EXTRA_PATHS) {
    if (budget.requests >= LIMITS.maxRequests || Date.now() - budget.started > LIMITS.maxMs) break;
    const url = new URL(path, ctx.origin).toString();
    if (seen.has(url) || isActionUrl(url)) continue;
    seen.add(url);
    const response = await timedGet(ctx, url, session, budget);
    if (response) captured.push(toCall(session, response));
  }
}

async function runIdor(ctx: ScanContext, sessions: AuthSession[], captured: CapturedCall[], budget: Budget): Promise<void> {
  if (sessions.length < 2) {
    ctx.note("Cross-account checks need two test accounts. Other logged-in checks ran with the account that signed in.");
    return;
  }
  const byLabel = new Map(sessions.map((session) => [session.label, session]));
  let leaks = 0;
  for (const call of captured) {
    if (leaks >= 4 || budget.requests >= LIMITS.maxRequests) break;
    if (!isObjectFetch(call.url, call.body) || call.status !== 200) continue;
    const other = [...byLabel.values()].find((session) => session.label !== call.label);
    if (!other) continue;
    const replay = await timedGet(ctx, call.url, other, budget);
    if (!replay) continue;
    const direct = crossAccountLeak({ ownerBody: call.body, replayStatus: replay.status, replayBody: replay.body });
    const ownerIds = [...new Set([...idsInUrl(call.url), ...extractMarkers(call.body).ids])];
    const foreignIds = captured
      .filter((item) => item.label === other.label)
      .flatMap((item) => [...extractMarkers(item.body).ids, ...idsInUrl(item.url)]);
    let swapped: { url: string; status: number; body: string; markers: string[] } | null = null;
    for (const fromId of ownerIds) {
      if (swapped || budget.requests >= LIMITS.maxRequests) break;
      const toId = foreignIds.find((id) => id !== fromId);
      if (!toId) continue;
      const swappedUrl = swapUrlId(call.url, fromId, toId);
      if (!swappedUrl || swappedUrl === call.url) continue;
      const session = byLabel.get(call.label);
      if (!session) continue;
      const response = await timedGet(ctx, swappedUrl, session, budget);
      if (!response) continue;
      const foreign = markerList(extractMarkers(replay.body));
      const own = markerList(extractMarkers(call.body));
      const leak = swappedIdLeak({ status: response.status, body: response.body, foreignMarkers: [...foreign, toId], ownMarkers: own });
      if (leak.leak) swapped = { url: swappedUrl, status: response.status, body: response.body, markers: leak.markers };
    }
    if (!direct.leak && !swapped) continue;
    leaks += 1;
    const proofResponse = direct.leak ? replay : { url: swapped?.url || replay.url, status: swapped?.status || replay.status, headers: replay.headers, body: swapped?.body || replay.body, setCookies: [], location: null };
    ctx.add(
      "auth_idor_bola",
      `Signed in as account ${other.label}, a read of account ${call.label}'s object returned that account's data. Values are masked.`,
      ctx.detailFor(proofResponse, {
        requestHeaders: { accept: "application/json" },
        locations: [
          { method: "GET", url: call.url },
          { method: "GET", url: proofResponse.url },
        ],
        steps: [
          `Sign in as throwaway account ${other.label} and send GET ${call.url}.`,
          `The body matches a record collected as account ${call.label}. Repeat with the accounts swapped, and with the id from one account placed in the other's URL.`,
          "Authorize the object owner on the server before returning the record.",
        ],
      }),
      "high",
    );
  }
}

function runVertical(ctx: ScanContext, captured: CapturedCall[]): void {
  for (const call of captured) {
    const profile = profileFor(captured, call.label);
    if (profile.role === "admin") continue;
    if (!isPrivilegedResponse(call.url, call.status, call.body)) continue;
    ctx.add(
      "auth_vertical_privilege",
      `A normal signed-in test account could read an admin route. The response was masked.`,
      ctx.detailFor(asProbe(call), {
        requestHeaders: { accept: "*/*" },
        steps: reproduce(
          "GET",
          call.url,
          "The signed-in test account is not an admin, and the response still includes admin data.",
          "Check the role on the server and return 403 for everyone else.",
        ),
      }),
      "high",
    );
    return;
  }
}

function runPaywall(ctx: ScanContext, captured: CapturedCall[]): void {
  for (const call of captured) {
    if (!/premium|\/pro(\/|$|\?)/i.test(call.url)) continue;
    const plan = readPlan(profileFor(captured, call.label).body);
    const result = paywallBypass({ plan, status: call.status, body: call.body });
    if (!result.bypass) continue;
    ctx.add(
      "auth_paywall_bypass",
      `A test account${plan ? ` on the ${plan} plan` : ""} received premium content from a read-only request. Confidence: ${result.confidence}.`,
      ctx.detailFor(asProbe(call), {
        steps: [
          `Sign in as the free throwaway account and send GET ${call.url}.`,
          "The response includes premium content without a paid plan on the profile.",
          "Check the purchase on the server before returning paid data.",
        ],
      }),
      result.confidence,
    );
    return;
  }
}

function runSensitive(ctx: ScanContext, captured: CapturedCall[]): void {
  const own = captured.flatMap((call) => extractMarkers(profileFor(captured, call.label).body).emails);
  for (const call of captured) {
    const allEmails = extractMarkers(call.body).emails;
    const others = otherUserEmails(call.body, own);
    const secret = /sk_(?:live|test)_[A-Za-z0-9]+|AKIA[0-9A-Z]{16}|service_role/i.test(call.body);
    const bulk = others.length >= 1 && allEmails.length >= 2;
    if (!bulk && !secret) continue;
    const confidence: Confidence = secret || others.length >= 2 ? "high" : "medium";
    ctx.add(
      "auth_sensitive_exposure",
      secret
        ? "A signed-in response included a private credential. The value was redacted."
        : `A signed-in response included ${others.length} email addresses that are not the signed-in test account. Addresses were masked.`,
      ctx.detailFor(asProbe(call), {
        steps: [
          `Sign in as the throwaway test account and send GET ${call.url}.`,
          secret ? "The body includes a private credential that should stay on the server." : "The body lists other people's email addresses.",
          "Return only the signed-in user's own record, and keep secrets on the server.",
        ],
      }),
      confidence,
    );
  }
}

function runSession(ctx: ScanContext, sessions: AuthSession[], captured: CapturedCall[]): void {
  const cookieIssues: string[] = [];
  const seenCookies = new Set<string>();
  for (const cookie of sessions.flatMap((session) => session.setCookies)) {
    const inspected = inspectCookieFlags(cookie);
    if (!inspected || seenCookies.has(inspected.name)) continue;
    seenCookies.add(inspected.name);
    cookieIssues.push(`${inspected.name} is missing ${inspected.missing.join(", ")}`);
  }
  const jwtNotes: string[] = [];
  let confidence: Confidence = cookieIssues.length > 0 ? "medium" : "low";
  const blobs = [...sessions.flatMap((session) => [session.bearer || "", session.cookieHeader]), ...captured.map((call) => call.body)];
  const seenJwt = new Set<string>();
  for (const blob of blobs) {
    for (const token of findJwts(blob)) {
      if (seenJwt.has(token)) continue;
      seenJwt.add(token);
      ctx.rememberSecret(token);
      const inspected = inspectJwt(token);
      if (!inspected) continue;
      if (inspected.algNone) {
        jwtNotes.push("a session token declares alg none");
        confidence = "high";
      }
      if (inspected.missingExp) jwtNotes.push("a session token has no exp claim, so it does not expire on its own");
      if (inspected.sensitiveClaims.length > 0) {
        jwtNotes.push(`a session token carries sensitive claims (${inspected.sensitiveClaims.join(", ")})`);
        confidence = "high";
      }
    }
  }
  if (cookieIssues.length === 0 && jwtNotes.length === 0) return;
  const sample = captured.find((call) => call.status > 0) ?? {
    url: ctx.origin,
    status: 200,
    body: "",
    contentType: "text/plain",
    setCookies: sessions[0]?.setCookies ?? [],
    label: sessions[0]?.label ?? "A",
    method: "GET" as const,
  };
  const summary = [...cookieIssues, ...jwtNotes].slice(0, 4).join("; ");
  ctx.add(
    "auth_session_weakness",
    `${summary}. This check does not sign the account out. Cookie and token values were redacted.`,
    ctx.detailFor(asProbe(sample), {
      snippetLines: cookieIssues.map((issue) => `set-cookie: ${issue.replace(/=.*/, "=[redacted]")}`),
      steps: [
        "Sign in with the throwaway test account and inspect the session cookie and token. Do not copy the secret into a ticket.",
        summary,
        "Set HttpOnly, Secure, and SameSite on the cookie, give the token an expiry, and keep secrets out of the payload.",
      ],
    }),
    confidence,
  );
}

async function runBackend(ctx: ScanContext, sessions: AuthSession[], captured: CapturedCall[], budget: Budget): Promise<void> {
  const targets: string[] = [];
  if (ctx.config.supabaseUrl) targets.push(`${ctx.config.supabaseUrl.replace(/\/$/, "")}/rest/v1/users?select=id,email&limit=5`);
  targets.push(new URL("/rest/v1/users?select=id,email&limit=5", ctx.origin).toString());
  if (ctx.config.firebaseDatabaseUrl) targets.push(`${ctx.config.firebaseDatabaseUrl.replace(/\/$/, "")}/users.json`);
  targets.push(new URL("/rtdb/users.json", ctx.origin).toString());
  for (const session of sessions) {
    const own = extractMarkers(profileFor(captured, session.label).body).emails;
    if (own.length === 0 && session.label) {
      const accountEmails = captured.filter((call) => call.label === session.label).flatMap((call) => extractMarkers(call.body).emails);
      own.push(...accountEmails.slice(0, 1));
    }
    for (const url of targets) {
      if (budget.requests >= LIMITS.maxRequests || Date.now() - budget.started > LIMITS.maxMs) return;
      const already = captured.find((call) => call.label === session.label && call.url === url && call.status === 200);
      const response = already ? asProbe(already) : await timedGet(ctx, url, session, budget);
      if (!response || response.status !== 200) continue;
      const others = otherUserEmails(response.body, own);
      if (others.length === 0) continue;
      const where = /firebase|rtdb/i.test(url) ? "Firebase-style data" : "the table API";
      ctx.add(
        "auth_backend_cross_user",
        `A signed-in user token could read other people's rows from ${where}. Addresses were masked.`,
        ctx.detailFor(response, {
          requestHeaders: { accept: "application/json" },
          steps: reproduce(
            "GET",
            response.url,
            "The signed-in user token is sent, and the body includes rows for more than that user.",
            "Restrict the query to the signed-in user id with row level security or security rules.",
          ),
        }),
        "high",
      );
      return;
    }
  }
}

interface Budget {
  requests: number;
  started: number;
}

async function timedGet(ctx: ScanContext, url: string, session: AuthSession, budget: Budget) {
  if (budget.requests >= LIMITS.maxRequests || Date.now() - budget.started > LIMITS.maxMs) return null;
  if (!sameOrigin(url, ctx.origin) && !isKnownBackend(url)) return null;
  if (isActionUrl(url)) return null;
  budget.requests += 1;
  if (budget.requests > 1) await sleep(LIMITS.delayMs);
  try {
    return await readOnlyGet(ctx, url, session);
  } catch (error) {
    console.warn(`signed-in read skipped: ${error instanceof Error ? error.name : "error"}`);
    return null;
  }
}

function toCall(session: AuthSession, response: { url: string; status: number; headers: Record<string, string>; body: string; setCookies: string[] }): CapturedCall {
  return {
    label: session.label,
    method: "GET",
    url: response.url,
    status: response.status,
    body: response.body,
    contentType: response.headers["content-type"] || "",
    setCookies: response.setCookies,
  };
}

function asProbe(call: CapturedCall) {
  return {
    url: call.url,
    status: call.status,
    headers: { "content-type": call.contentType },
    body: call.body,
    setCookies: call.setCookies,
    location: null,
  };
}

function profileFor(captured: CapturedCall[], label: "A" | "B"): { body: string; role: string | null } {
  const profile = captured.find((call) => call.label === label && /\/api\/(me|user|profile)(\?|$)/.test(call.url) && call.status === 200);
  return { body: profile?.body || "", role: profile ? readRole(profile.body) : null };
}

function sawAuthenticatedData(captured: CapturedCall[]): boolean {
  return captured.some((call) => {
    if (call.status < 200 || call.status >= 300) return false;
    if (/\/api\/|\/admin|\/rest\/|\/rtdb\/|\/app|\/premium/.test(call.url)) return true;
    return call.body.includes("data-admin-panel") || call.body.includes('"plan"');
  });
}

export function extractSameOriginLinks(html: string, base: string, origin: string): string[] {
  const links: string[] = [];
  const originUrl = new URL(origin);
  for (const match of html.matchAll(/\b(?:href|src)=["']([^"'#]+)["']/gi)) {
    try {
      const url = new URL(match[1], base);
      if (url.origin !== originUrl.origin) continue;
      if (isActionUrl(url.toString())) continue;
      if (/\.(css|png|jpe?g|gif|svg|ico|woff2?|map)(\?|$)/i.test(url.pathname)) continue;
      url.hash = "";
      links.push(url.toString());
    } catch {
      // ignore malformed links
    }
  }
  return [...new Set(links)];
}

function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

function isKnownBackend(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith(".supabase.co") || host.endsWith(".firebaseio.com") || host === "firestore.googleapis.com";
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
