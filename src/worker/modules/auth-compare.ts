const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const UUID_EXACT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PrivateMarkers {
  emails: string[];
  ids: string[];
  notes: string[];
}

export function extractMarkers(body: string): PrivateMarkers {
  const emails = new Set<string>();
  const ids = new Set<string>();
  const notes = new Set<string>();
  for (const match of body.match(EMAIL) ?? []) emails.add(match.toLowerCase());
  for (const match of body.match(UUID) ?? []) ids.add(match.toLowerCase());
  try {
    collectJson(JSON.parse(body) as unknown, ids, notes);
  } catch {
    // not JSON
  }
  return {
    emails: [...emails],
    ids: [...ids].filter((id) => id.length >= 2 && id.length <= 80),
    notes: [...notes].filter((note) => note.length >= 8 && note.length <= 120),
  };
}

function collectJson(value: unknown, ids: Set<string>, notes: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectJson(item, ids, notes);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === "string" || typeof child === "number") {
      const text = String(child);
      if (/^(id|user_?id|owner_?id|uuid)$/i.test(key) && text.length >= 2 && text.length <= 80) ids.add(text);
      if (/^(note|secret|private|content|lesson)$/i.test(key) && text.length >= 8) notes.add(text);
    } else {
      collectJson(child, ids, notes);
    }
  }
}

export function markerList(markers: PrivateMarkers): string[] {
  return [...markers.emails, ...markers.ids, ...markers.notes];
}

export function isDenied(body: string): boolean {
  const trimmed = body.trim();
  if (/^(unauthorized|forbidden|not found)$/i.test(trimmed)) return true;
  if (/"error"\s*:\s*"(unauthorized|forbidden)"/i.test(trimmed)) return true;
  if (/<input[^>]+type=["']password["']/i.test(body) && /log in|sign in/i.test(body)) return true;
  return false;
}

export function crossAccountLeak(input: { ownerBody: string; replayStatus: number; replayBody: string }): { leak: boolean; markers: string[] } {
  if (input.replayStatus < 200 || input.replayStatus >= 300) return { leak: false, markers: [] };
  if (isDenied(input.replayBody)) return { leak: false, markers: [] };
  const markers = markerList(extractMarkers(input.ownerBody));
  const matched = markers.filter((marker) => input.replayBody.toLowerCase().includes(marker.toLowerCase()));
  if (matched.length === 0) return { leak: false, markers: [] };
  return { leak: true, markers: matched.slice(0, 5) };
}

export function idsInUrl(url: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  const skip = new Set(["api", "v1", "v2", "rest", "users", "user", "notes", "note", "admin", "me", "profile", "rtdb", "assets"]);
  const ids: string[] = [];
  for (const part of parsed.pathname.split("/").filter(Boolean)) {
    if (skip.has(part.toLowerCase())) continue;
    if (part.length < 2 || part.length > 80) continue;
    if (/[0-9_]/.test(part) || UUID_EXACT.test(part)) ids.push(part);
  }
  for (const value of parsed.searchParams.values()) {
    if (value.length >= 2 && value.length <= 80 && /[0-9_]/.test(value)) ids.push(value);
  }
  return [...new Set(ids)];
}

export function isObjectFetch(url: string, body: string): boolean {
  if (/\.(js|css|png|jpe?g|gif|svg|ico|woff2?|map)(\?|$)/i.test(url)) return false;
  if (idsInUrl(url).length > 0) return true;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      return record.id !== undefined || record.user_id !== undefined || record.userId !== undefined;
    }
  } catch {
    return false;
  }
  return false;
}

export function swapUrlId(url: string, fromId: string, toId: string): string | null {
  if (!fromId || fromId === toId) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  let changed = false;
  const parts = parsed.pathname.split("/").map((part) => {
    if (part !== fromId) return part;
    changed = true;
    return toId;
  });
  parsed.pathname = parts.join("/") || "/";
  for (const [key, value] of [...parsed.searchParams.entries()]) {
    if (value !== fromId) continue;
    parsed.searchParams.set(key, toId);
    changed = true;
  }
  if (!changed) return null;
  if (parsed.origin !== new URL(url).origin) return null;
  return parsed.toString();
}

export function swappedIdLeak(input: { status: number; body: string; foreignMarkers: string[]; ownMarkers: string[] }): {
  leak: boolean;
  markers: string[];
} {
  if (input.status < 200 || input.status >= 300) return { leak: false, markers: [] };
  if (isDenied(input.body)) return { leak: false, markers: [] };
  const own = new Set(input.ownMarkers.map((marker) => marker.toLowerCase()));
  const matched = input.foreignMarkers.filter((marker) => {
    if (marker.length < 4) return false;
    if (own.has(marker.toLowerCase())) return false;
    return input.body.toLowerCase().includes(marker.toLowerCase());
  });
  return { leak: matched.length > 0, markers: matched.slice(0, 5) };
}

export function isPrivilegedResponse(url: string, status: number, body: string): boolean {
  if (status !== 200) return false;
  if (isDenied(body)) return false;
  if (body.includes("data-admin-panel")) return true;
  if (/"role"\s*:\s*"admin"/i.test(body)) return true;
  if (/\/admin(\/|$|\?)/i.test(url)) {
    const emails = body.match(EMAIL) ?? [];
    if (emails.length >= 2) return true;
  }
  return false;
}

export function paywallBypass(input: { plan: string | null; status: number; body: string }): {
  bypass: boolean;
  confidence: "high" | "medium" | "low";
} {
  if (input.status !== 200 || isDenied(input.body)) return { bypass: false, confidence: "low" };
  const paidContent = /"access"\s*:\s*"premium"|paid lesson|premium content|pro content/i.test(input.body);
  const wall = /payment required|upgrade to|subscribe to unlock/i.test(input.body);
  if (!paidContent || wall) return { bypass: false, confidence: "low" };
  const plan = (input.plan ?? "").toLowerCase();
  if (["free", "basic", "none", "trial", "unpaid"].includes(plan)) return { bypass: true, confidence: "high" };
  if (["pro", "premium", "paid", "active", "enterprise"].includes(plan)) return { bypass: false, confidence: "low" };
  if (!plan) return { bypass: true, confidence: "medium" };
  return { bypass: true, confidence: "low" };
}

export function inspectJwt(token: string): { algNone: boolean; missingExp: boolean; sensitiveClaims: string[] } | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const header = JSON.parse(decodeBase64Url(parts[0])) as { alg?: unknown };
    const payload = JSON.parse(decodeBase64Url(parts[1])) as Record<string, unknown>;
    if (!header || typeof header !== "object" || !payload || typeof payload !== "object") return null;
    const alg = typeof header.alg === "string" ? header.alg : "";
    const sensitive = ["password", "secret", "api_key", "apikey", "service_role", "private_key"].filter((key) => key in payload);
    if (!alg && sensitive.length === 0 && payload.exp !== undefined) return null;
    return {
      algNone: alg.toLowerCase() === "none",
      missingExp: payload.exp === undefined,
      sensitiveClaims: sensitive,
    };
  } catch {
    return null;
  }
}

export function inspectCookieFlags(setCookie: string): { name: string; missing: string[] } | null {
  const [pair, ...attrs] = setCookie.split(";").map((part) => part.trim());
  const name = pair.split("=")[0]?.trim() || "";
  if (!name || !/session|sid|auth|token|jwt/i.test(name)) return null;
  const flags = attrs.map((part) => part.toLowerCase());
  const missing: string[] = [];
  if (!flags.includes("secure")) missing.push("Secure");
  if (!flags.includes("httponly")) missing.push("HttpOnly");
  if (!flags.some((part) => part === "samesite=lax" || part === "samesite=strict")) missing.push("SameSite");
  if (missing.length === 0) return null;
  return { name, missing };
}

export function otherUserEmails(body: string, ownEmails: string[]): string[] {
  const own = new Set(ownEmails.map((email) => email.toLowerCase()));
  const emails = [...new Set((body.match(EMAIL) ?? []).map((email) => email.toLowerCase()))];
  return emails.filter((email) => !own.has(email));
}

export function readPlan(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { plan?: unknown; role?: unknown };
    if (typeof parsed.plan === "string") return parsed.plan;
  } catch {
    const match = body.match(/"plan"\s*:\s*"([^"]+)"/i);
    if (match) return match[1];
  }
  return null;
}

export function readRole(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { role?: unknown };
    if (typeof parsed.role === "string") return parsed.role;
  } catch {
    return null;
  }
  return null;
}

function decodeBase64Url(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.length % 4 === 0 ? base64 : base64 + "=".repeat(4 - (base64.length % 4));
  return Buffer.from(padded, "base64").toString("utf8");
}

export function findJwts(text: string): string[] {
  return text.match(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g) ?? [];
}
