import { jwtRole } from "@/lib/sanitize";
import type { DiscoveredConfig, ScriptDocument } from "./context";

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

export function findSecretKinds(source: string): string[] {
  const kinds = new Set<string>();
  for (const match of source.matchAll(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g)) {
    if (jwtRole(match[0]) === "service_role") kinds.add("a service-role credential");
  }
  if (/\bsk_live_[A-Za-z0-9]{8,}/.test(source)) kinds.add("a Stripe live secret key");
  if (/\bsk_test_[A-Za-z0-9]{8,}/.test(source)) kinds.add("a Stripe secret key");
  if (/\bsk-[A-Za-z0-9_-]{16,}/.test(source)) kinds.add("an OpenAI-style secret key");
  if (/\bre_[A-Za-z0-9_]{10,}/.test(source)) kinds.add("a Resend-style API key");
  if (/\bAKIA[0-9A-Z]{16}\b/.test(source)) kinds.add("an AWS access key id");
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(source)) kinds.add("a PEM private key");
  if (/(?:NEXT_PUBLIC|VITE)_[A-Z0-9_]*(?:SECRET|SERVICE_ROLE|PRIVATE)/.test(source) && kinds.size > 0) {
    kinds.add("a NEXT_PUBLIC_ or VITE_ variable holding a private key");
  }
  if (/(?:NEXT_PUBLIC|VITE)_[A-Z0-9_]*\s*=\s*["'](?:sk_live_|sk_test_|sk-|re_|AKIA)/.test(source)) {
    kinds.add("a NEXT_PUBLIC_ or VITE_ variable holding a private key");
  }
  return [...kinds];
}
