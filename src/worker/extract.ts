import { indexToLine, maskSecret } from "@/lib/finding-detail";
import { jwtRole } from "@/lib/sanitize";
import type { DiscoveredConfig, ScriptDocument } from "./context";

export interface SecretHit {
  kind: string;
  url: string;
  line: number;
  column: number;
  masked: string;
}

export function extractAssets(html: string, base: URL): { scripts: string[]; links: string[] } {
  const scripts: string[] = [];
  const links: string[] = [];
  for (const match of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
    try {
      scripts.push(new URL(match[1], base).toString());
    } catch {
      // Ignore malformed URLs in the page.
    }
  }
  for (const match of html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
    try {
      links.push(new URL(match[1], base).toString());
    } catch {
      // Ignore malformed URLs in the page.
    }
  }
  return { scripts, links };
}

export function extractInlineScripts(html: string): string[] {
  const blocks: string[] = [];
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (match[1]?.trim()) blocks.push(match[1]);
  }
  return blocks;
}

export function extractConfig(documents: ScriptDocument[], origin: string): DiscoveredConfig {
  const source = documents.map((document) => document.body).join("\n");
  const assignments = new Map<string, string>();
  for (const match of source.matchAll(/(?:const|let|var)\s+([A-Z0-9_]+)\s*=\s*["']([^"']+)["']/g)) {
    assignments.set(match[1], match[2]);
  }
  const supabaseUrl = absoluteUrl(assignments.get("SUPABASE_URL"), origin);
  const firebaseDatabaseUrl = absoluteUrl(assignments.get("FIREBASE_DATABASE_URL"), origin);
  let serviceRoleKey = assignments.get("SUPABASE_SERVICE_ROLE_KEY") ?? null;
  let supabaseAnonKey = assignments.get("SUPABASE_ANON_KEY") ?? null;

  for (const match of source.matchAll(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g)) {
    const role = jwtRole(match[0]);
    if (role === "service_role" && !serviceRoleKey) serviceRoleKey = match[0];
    if (role === "anon" && !supabaseAnonKey) supabaseAnonKey = match[0];
  }

  const supabaseHost = source.match(/https?:\/\/[a-z0-9-]+\.supabase\.co/i)?.[0] ?? null;
  return {
    supabaseUrl: supabaseUrl ?? supabaseHost,
    supabaseAnonKey,
    serviceRoleKey,
    firebaseDatabaseUrl,
    firebaseProjectId: assignments.get("FIREBASE_PROJECT_ID") ?? null,
  };
}

function absoluteUrl(value: string | undefined, origin: string): string | null {
  if (!value) return null;
  try {
    return new URL(value, origin).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

const SECRET_PATTERNS: Array<{ kind: string; source: string; accept?: (value: string) => boolean }> = [
  {
    kind: "a service-role credential",
    source: "\\beyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{4,}",
    accept: (value) => jwtRole(value) === "service_role",
  },
  { kind: "a Stripe live secret key", source: "\\bsk_live_[A-Za-z0-9]{8,}" },
  { kind: "a Stripe secret key", source: "\\bsk_test_[A-Za-z0-9]{8,}" },
  { kind: "an OpenAI-style secret key", source: "\\bsk-[A-Za-z0-9_-]{16,}" },
  { kind: "a Resend-style API key", source: "\\bre_[A-Za-z0-9_]{10,}" },
  { kind: "an AWS access key id", source: "\\bAKIA[0-9A-Z]{16}\\b" },
  { kind: "a PEM private key", source: "-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----" },
];

export function locateText(
  documents: Array<{ url: string; body: string }>,
  pattern: RegExp,
): { url: string; line: number; column: number } | null {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  for (const doc of documents) {
    const expression = new RegExp(pattern.source, flags);
    const match = expression.exec(doc.body);
    if (!match || match.index === undefined) continue;
    const position = indexToLine(doc.body, match.index);
    return { url: doc.url, line: position.line, column: position.column };
  }
  return null;
}

export function locateSecretHits(documents: Array<{ url: string; body: string }>): SecretHit[] {
  const hits: Array<SecretHit & { index: number; doc: number }> = [];
  documents.forEach((doc, docIndex) => {
    for (const pattern of SECRET_PATTERNS) {
      const expression = new RegExp(pattern.source, "g");
      for (const match of doc.body.matchAll(expression)) {
        const value = match[0];
        if (pattern.accept && !pattern.accept(value)) continue;
        const index = match.index ?? 0;
        const position = indexToLine(doc.body, index);
        hits.push({
          kind: pattern.kind,
          url: doc.url,
          line: position.line,
          column: position.column,
          masked: maskSecret(value),
          index,
          doc: docIndex,
        });
      }
    }
  });
  hits.sort((left, right) => left.doc - right.doc || left.index - right.index);
  const seen = new Set<string>();
  const unique: SecretHit[] = [];
  for (const hit of hits) {
    const key = `${hit.url}:${hit.line}:${hit.column}:${hit.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ kind: hit.kind, url: hit.url, line: hit.line, column: hit.column, masked: hit.masked });
  }
  return unique;
}

export function findSecretKinds(source: string): string[] {
  const kinds = new Set(locateSecretHits([{ url: "source", body: source }]).map((hit) => hit.kind));
  if (/(?:NEXT_PUBLIC|VITE)_[A-Z0-9_]*(?:SECRET|SERVICE_ROLE|PRIVATE)/.test(source) && kinds.size > 0) {
    kinds.add("a NEXT_PUBLIC_ or VITE_ variable holding a private key");
  }
  if (/(?:NEXT_PUBLIC|VITE)_[A-Z0-9_]*\s*=\s*["'](?:sk_live_|sk_test_|sk-|re_|AKIA)/.test(source)) {
    kinds.add("a NEXT_PUBLIC_ or VITE_ variable holding a private key");
  }
  return [...kinds];
}
