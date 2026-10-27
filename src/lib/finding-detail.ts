import type { ProbeResponse } from "./http";
import { scannerUserAgent } from "./scanner-identity";
import { redactSecrets, sanitizeCustomerText } from "./sanitize";
import { toolBrandPattern } from "./tool-denylist";

export interface FindingLocation {
  method: string;
  url: string;
  line?: number;
  column?: number;
  maskedSecret?: string;
}

export interface FindingRequestHeader {
  name: string;
  value: string;
}

export interface FindingProof {
  method: string;
  url: string;
  headers: FindingRequestHeader[];
  status: number;
  responseSnippet: string;
}

export interface FindingDetail {
  locations: FindingLocation[];
  proof: FindingProof;
  steps: string[];
}

const SNIPPET_MAX = 300;
const SENSITIVE_HEADER = /authorization|api[-_]?key|cookie|token|secret|password|signature/i;

export function maskSecret(value: string): string {
  const pem = value.match(/-----BEGIN [A-Z ]*PRIVATE KEY-----([\s\S]*?)-----END [A-Z ]*PRIVATE KEY-----/);
  const core = (pem?.[1] ?? value).replace(/\s+/g, "");
  if (core.length <= 8) return "••••";
  return `${core.slice(0, 4)}…${core.slice(-4)}`;
}

export function indexToLine(source: string, index: number): { line: number; column: number } {
  const clipped = Math.max(0, Math.min(index, source.length));
  const before = source.slice(0, clipped);
  const line = before.split("\n").length;
  const column = clipped - before.lastIndexOf("\n");
  return { line, column };
}

export function redactHeaderValue(name: string, value: string): string {
  if (SENSITIVE_HEADER.test(name)) {
    if (name.toLowerCase() === "set-cookie") return redactCookiePair(value);
    return "[redacted]";
  }
  return clip(redactProbeText(value), 160);
}

function redactCookiePair(cookie: string): string {
  const [pair, ...attrs] = cookie.split(";");
  const name = pair.split("=")[0]?.trim() || "cookie";
  const flags = attrs.map((part) => part.trim()).filter(Boolean);
  return [`${name}=[redacted]`, ...flags].join("; ");
}

export function redactProbeText(input: string): string {
  const secrets = redactSecrets(input);
  const emails = secrets.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");
  const phones = emails.replace(/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g, "[phone]");
  return phones.replace(toolBrandPattern(), "automated check");
}

export function clip(input: string, max = SNIPPET_MAX): string {
  const clean = input.replace(/\r\n/g, "\n").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

export function responseSnippet(response: Pick<ProbeResponse, "status" | "headers" | "body">, extraLines: string[] = []): string {
  const interesting = [
    "content-type",
    "content-security-policy",
    "strict-transport-security",
    "access-control-allow-origin",
    "access-control-allow-credentials",
    "access-control-allow-methods",
    "x-frame-options",
    "x-content-type-options",
    "referrer-policy",
    "allow",
    "location",
    "www-authenticate",
    "retry-after",
  ];
  const lines = [`HTTP ${response.status}`, ...extraLines];
  for (const name of interesting) {
    const value = response.headers[name];
    if (value) lines.push(`${name}: ${redactHeaderValue(name, value)}`);
  }
  const headerBlock = lines.join("\n");
  const body = redactProbeText(response.body).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!body) return clip(headerBlock);
  const room = SNIPPET_MAX - headerBlock.length - 2;
  if (room < 24) return clip(headerBlock);
  return clip(`${headerBlock}\n\n${body.slice(0, room)}`);
}

export function buildProof(input: {
  method: string;
  url: string;
  requestHeaders?: Record<string, string>;
  response: Pick<ProbeResponse, "status" | "headers" | "body">;
  snippetLines?: string[];
}): FindingProof {
  const headers = new Map<string, string>();
  headers.set("accept", input.requestHeaders?.accept || "*/*");
  for (const [name, value] of Object.entries(input.requestHeaders ?? {})) {
    headers.set(name.toLowerCase(), value);
  }
  headers.set("user-agent", scannerUserAgent());
  return {
    method: input.method.toUpperCase(),
    url: input.url,
    headers: [...headers.entries()].map(([name, value]) => ({ name, value: redactHeaderValue(name, value) })),
    status: input.response.status,
    responseSnippet: responseSnippet(input.response, input.snippetLines),
  };
}

export function normalizeSteps(steps: string[]): string[] {
  return steps
    .map((step) => sanitizeCustomerText(step))
    .filter((step) => step.length > 0)
    .slice(0, 3);
}

export function sanitizeDetail(detail: FindingDetail): FindingDetail {
  const locations = detail.locations.slice(0, 6).map((location) => {
    const next: FindingLocation = {
      method: location.method.toUpperCase(),
      url: sanitizeCustomerText(location.url),
    };
    if (location.line && location.line > 0) next.line = Math.floor(location.line);
    if (location.column && location.column > 0) next.column = Math.floor(location.column);
    if (location.maskedSecret) next.maskedSecret = location.maskedSecret;
    return next;
  });
  return {
    locations,
    proof: {
      method: detail.proof.method.toUpperCase(),
      url: sanitizeCustomerText(detail.proof.url),
      headers: detail.proof.headers.map((header) => ({
        name: header.name.toLowerCase(),
        value: redactHeaderValue(header.name, header.value),
      })),
      status: detail.proof.status,
      responseSnippet: clip(redactProbeText(detail.proof.responseSnippet)),
    },
    steps: normalizeSteps(detail.steps),
  };
}

export function parseStoredDetail(raw: unknown): Partial<FindingDetail> & { confidence?: "high" | "medium" | "low" } {
  if (!raw || typeof raw !== "object") return {};
  const value = raw as Record<string, unknown>;
  const locations = Array.isArray(value.locations) ? value.locations.filter(isLocation) : [];
  const proof = isProof(value.proof) ? value.proof : undefined;
  const steps = Array.isArray(value.steps) ? value.steps.filter((step): step is string => typeof step === "string") : [];
  const confidence = value.confidence === "high" || value.confidence === "medium" || value.confidence === "low" ? value.confidence : undefined;
  if (locations.length === 0 || !proof) return confidence ? { confidence } : {};
  return { locations, proof, steps, ...(confidence ? { confidence } : {}) };
}

function isLocation(value: unknown): value is FindingLocation {
  if (!value || typeof value !== "object") return false;
  const location = value as Partial<FindingLocation>;
  return typeof location.method === "string" && typeof location.url === "string";
}

function isProof(value: unknown): value is FindingProof {
  if (!value || typeof value !== "object") return false;
  const proof = value as Partial<FindingProof>;
  return (
    typeof proof.method === "string" &&
    typeof proof.url === "string" &&
    typeof proof.status === "number" &&
    typeof proof.responseSnippet === "string" &&
    Array.isArray(proof.headers)
  );
}

export function reproduce(method: string, url: string, saw: string, next?: string): string[] {
  const steps = [`Send ${method.toUpperCase()} ${url} with no session cookie.`, saw];
  if (next) steps.push(next);
  return steps.slice(0, 3);
}
