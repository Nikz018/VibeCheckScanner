import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class ProbeBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProbeBlockedError";
  }
}

const BLOCKED_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.google.com",
  "metadata.goog",
  "instance-data",
]);

export function isPrivateAddress(ip: string): boolean {
  const mapped = ip.toLowerCase().startsWith("::ffff:") ? ip.slice(7) : ip;
  if (mapped === "::1" || mapped === "0.0.0.0") return true;
  const version = isIP(mapped);
  if (version === 4) {
    const parts = mapped.split(".").map(Number);
    const [a, b] = parts;
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return true;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (version === 6) {
    const first = mapped.toLowerCase().split(":")[0] || "0";
    const word = parseInt(first, 16);
    if (Number.isNaN(word)) return true;
    if (word >= 0xfc00 && word <= 0xfdff) return true;
    if (word >= 0xfe80 && word <= 0xfebf) return true;
    return false;
  }
  return true;
}

export function rewriteLocalhost(url: URL): URL {
  const host = process.env.LOCALHOST_REWRITE_HOST?.trim();
  if (!host) return url;
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    const next = new URL(url.toString());
    next.hostname = host;
    return next;
  }
  return url;
}

export function isBackendHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host.endsWith(".supabase.co") ||
    host.endsWith(".firebaseio.com") ||
    host.endsWith(".firebaseapp.com") ||
    host.endsWith(".appspot.com") ||
    host === "firestore.googleapis.com" ||
    host === "firebasestorage.googleapis.com"
  );
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host === "169.254.169.254") return true;
  return false;
}

export interface ProbeTarget {
  origin: string;
}

export function sameOrigin(candidate: URL, targetOrigin: string): boolean {
  const target = rewriteLocalhost(new URL(targetOrigin));
  const left = rewriteLocalhost(candidate);
  return left.protocol === target.protocol && left.host === target.host;
}

export async function assertProbeAllowed(rawUrl: string, targetOrigin: string): Promise<URL> {
  let url: URL;
  try {
    url = rewriteLocalhost(new URL(rawUrl));
  } catch {
    throw new ProbeBlockedError("URL is not valid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProbeBlockedError("Only http and https targets can be scanned");
  }
  if (url.username || url.password) {
    throw new ProbeBlockedError("URLs with embedded credentials are not scanned");
  }
  if (isBlockedHostname(url.hostname)) {
    throw new ProbeBlockedError("This host is blocked");
  }
  const allowLocal = process.env.ALLOW_LOCAL_TARGETS === "true";
  const localName = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (localName && !allowLocal) {
    throw new ProbeBlockedError("Local targets are disabled");
  }

  let addresses: string[] = [];
  if (isIP(url.hostname)) {
    addresses = [url.hostname];
  } else {
    const results = await lookup(url.hostname, { all: true, verbatim: true });
    addresses = results.map((entry) => entry.address);
  }
  const onTarget = sameOrigin(url, targetOrigin);
  for (const address of addresses) {
    if (isPrivateAddress(address) && !(allowLocal && onTarget)) {
      throw new ProbeBlockedError("Refusing a private or link-local address");
    }
  }
  if (!onTarget && !isBackendHostname(url.hostname)) {
    throw new ProbeBlockedError("Host is outside the verified origin");
  }
  return url;
}

export interface ProbeResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  setCookies: string[];
  body: string;
  location: string | null;
}

const METHODS = new Set(["GET", "HEAD", "OPTIONS", "POST"]);

export async function safeFetch(input: {
  url: string;
  targetOrigin: string;
  method?: "GET" | "HEAD" | "OPTIONS" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  follow?: boolean;
}): Promise<ProbeResponse> {
  const method = input.method ?? "GET";
  if (!METHODS.has(method)) {
    throw new ProbeBlockedError("Only GET, HEAD, OPTIONS, and POST are allowed");
  }
  if (method === "POST" && input.body && input.body.length > 2048) {
    throw new ProbeBlockedError("POST body is too large");
  }

  let current = await assertProbeAllowed(input.url, input.targetOrigin);
  let currentMethod = method;
  const maxHops = input.follow === false ? 1 : 3;

  for (let hop = 0; hop < maxHops; hop += 1) {
    const response = await fetch(current, {
      method: currentMethod,
      redirect: "manual",
      headers: {
        "user-agent": "VibeCheckScanner/0.1",
        accept: "*/*",
        ...(input.headers ?? {}),
      },
      body: currentMethod === "POST" ? input.body : undefined,
      signal: AbortSignal.timeout(input.timeoutMs ?? 8000),
      cache: "no-store",
    });

    const location = response.headers.get("location");
    if (location && [301, 302, 303, 307, 308].includes(response.status) && hop < maxHops - 1 && input.follow !== false) {
      const next = new URL(location, current);
      try {
        await assertProbeAllowed(next.toString(), input.targetOrigin);
      } catch {
        return await toProbe(response, current.toString(), input.maxBytes ?? 400_000);
      }
      current = rewriteLocalhost(next);
      if (currentMethod === "POST" && response.status !== 307 && response.status !== 308) {
        currentMethod = "GET";
      }
      continue;
    }
    return await toProbe(response, current.toString(), input.maxBytes ?? 400_000);
  }

  throw new ProbeBlockedError("Too many redirects");
}

async function toProbe(response: Response, url: string, maxBytes: number): Promise<ProbeResponse> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  const setCookies =
    typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : headers["set-cookie"] ? [headers["set-cookie"]] : [];
  const body = await readLimited(response, maxBytes);
  return {
    url,
    status: response.status,
    headers,
    setCookies,
    body,
    location: response.headers.get("location"),
  };
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > maxBytes) {
      chunks.push(value.slice(0, Math.max(0, value.byteLength - (received - maxBytes))));
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

export function originOf(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProbeBlockedError("Only http and https URLs can be scanned");
  }
  return url.origin;
}
