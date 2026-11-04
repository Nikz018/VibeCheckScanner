import { execFileSync } from "node:child_process";
import path from "node:path";
import type { SourceFile } from "./types";

export type ScanLanguage = "javascript" | "python" | "sql" | "env";

const PLACEHOLDER_SUBSTRINGS = [
  "redacted",
  "placeholder",
  "example",
  "dummy",
  "fake",
  "changeme",
  "sample",
  "notreal",
  "not-real",
  "not_real",
  "yourkey",
  "your_key",
  "your-key",
  "xxxx",
  "todo",
  "replace",
  "insertkey",
  "insert_key",
  "insert-key",
];

/** Directory or filename that holds tests, fixtures, docs, or examples. */
export function isNoisePath(file: string): boolean {
  const normalized = file.replace(/\\/g, "/").replace(/^history [0-9a-f]+:/i, "");
  if (/(?:^|\/)(?:__tests__|__mocks__|fixtures?|mocks?|e2e|docs|examples)(?:\/|$)/i.test(normalized)) return true;
  if (/(?:^|\/)(?:test|tests|spec|specs)\//i.test(normalized)) return true;
  if (/(?:^|\/)[^/]*\.(?:test|spec|fixture|mock)\.[cm]?[jt]sx?$/i.test(normalized)) return true;
  if (/(?:^|\/)[^/]*e2e[^/]*\.[cm]?[jt]sx?$/i.test(normalized)) return true;
  return false;
}

export function looksPlaceholder(value: string): boolean {
  const compact = value.toLowerCase();
  if (PLACEHOLDER_SUBSTRINGS.some((word) => compact.includes(word))) return true;
  if (/^<[^>\n]+>$/.test(value.trim())) return true;
  if (/(?:^|[_-])demo(?:[_-]|$|key)/i.test(value) || /demokey/i.test(value)) return true;
  return false;
}

/** Repeated characters or a long alphabet/digit run. Real provider keys do not look like this. */
export function lowEntropy(value: string): boolean {
  if (/(.)\1{7,}/.test(value)) return true;
  let run = 1;
  for (let i = 1; i < value.length; i += 1) {
    if (value.charCodeAt(i) === value.charCodeAt(i - 1) + 1) {
      run += 1;
      if (run >= 8) return true;
    } else {
      run = 1;
    }
  }
  const unique = new Set(value).size;
  if (value.length >= 16 && unique / value.length < 0.35) return true;
  return false;
}

function plausibleBody(value: string, body: string, min: number, alphabet: RegExp): boolean {
  if (body.length < min || !alphabet.test(body)) return false;
  if (looksPlaceholder(value) || looksPlaceholder(body)) return false;
  if (lowEntropy(body)) return false;
  if (!/\d/.test(body) || !/[A-Za-z]/.test(body)) return false;
  return true;
}

export interface SecretKeySpec {
  id: string;
  label: string;
  ai: boolean;
  source: string;
  accept: (value: string) => boolean;
}

export const SECRET_KEYS: SecretKeySpec[] = [
  {
    id: "anthropic",
    label: "an Anthropic API key",
    ai: true,
    source: "\\bsk-ant-[A-Za-z0-9_-]{48,}",
    accept: (value) => plausibleBody(value, value.replace(/^sk-ant-/i, ""), 48, /^[A-Za-z0-9_-]+$/),
  },
  {
    id: "openai_proj",
    label: "an OpenAI API key",
    ai: true,
    source: "\\bsk-proj-[A-Za-z0-9_-]{40,}",
    accept: (value) => plausibleBody(value, value.replace(/^sk-proj-/i, ""), 40, /^[A-Za-z0-9_-]+$/),
  },
  {
    id: "groq",
    label: "a Groq API key",
    ai: true,
    source: "\\bgsk_[A-Za-z0-9]{32,}",
    accept: (value) => plausibleBody(value, value.replace(/^gsk_/i, ""), 32, /^[A-Za-z0-9]+$/),
  },
  {
    id: "xai",
    label: "an xAI API key",
    ai: true,
    source: "\\bxai-[A-Za-z0-9_-]{32,}",
    accept: (value) => plausibleBody(value, value.replace(/^xai-/i, ""), 32, /^[A-Za-z0-9_-]+$/),
  },
  {
    id: "openai",
    label: "an OpenAI API key",
    ai: true,
    source: "\\bsk-[A-Za-z0-9_-]{32,}",
    accept: (value) => {
      if (/^sk-(?:ant|proj)-/i.test(value)) return false;
      return plausibleBody(value, value.replace(/^sk-/i, ""), 32, /^[A-Za-z0-9_-]+$/);
    },
  },
  {
    id: "stripe_live",
    label: "a Stripe live secret key",
    ai: false,
    source: "\\bsk_live_[A-Za-z0-9]{24,}",
    accept: (value) => plausibleBody(value, value.replace(/^sk_live_/i, ""), 24, /^[A-Za-z0-9]+$/),
  },
  {
    id: "stripe",
    label: "a Stripe secret key",
    ai: false,
    source: "\\bsk_test_[A-Za-z0-9]{24,}",
    accept: (value) => plausibleBody(value, value.replace(/^sk_test_/i, ""), 24, /^[A-Za-z0-9]+$/),
  },
  {
    id: "aws",
    label: "an AWS access key id",
    ai: false,
    source: "\\bAKIA[0-9A-Z]{16}\\b",
    accept: (value) => {
      const body = value.replace(/^AKIA/i, "");
      if (!/^[0-9A-Z]{16}$/.test(body)) return false;
      if (looksPlaceholder(value)) return false;
      if (lowEntropy(body)) return false;
      if (!/\d/.test(body) || !/[A-Z]/.test(body)) return false;
      return true;
    },
  },
  {
    id: "github",
    label: "a GitHub token",
    ai: false,
    source: "\\bghp_[A-Za-z0-9]{36}\\b",
    accept: (value) => plausibleBody(value, value.replace(/^ghp_/i, ""), 36, /^[A-Za-z0-9]+$/),
  },
  {
    id: "pem",
    label: "a private key",
    ai: false,
    source: "-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----",
    accept: (value) => {
      const body = value
        .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/i, "")
        .replace(/-----END [A-Z ]*PRIVATE KEY-----/i, "")
        .replace(/\s+/g, "");
      if (body.length < 80 || !/^[A-Za-z0-9+/=]+$/.test(body)) return false;
      if (looksPlaceholder(body) || lowEntropy(body)) return false;
      return true;
    },
  },
];

export interface AcceptedSecret {
  id: string;
  label: string;
  ai: boolean;
  value: string;
  index: number;
}

export function findAcceptedSecrets(text: string): AcceptedSecret[] {
  const found: AcceptedSecret[] = [];
  for (const key of SECRET_KEYS) {
    const expression = new RegExp(key.source, "gi");
    for (const match of text.matchAll(expression)) {
      if (match.index === undefined) continue;
      const value = match[0];
      if (!key.accept(value)) continue;
      found.push({ id: key.id, label: key.label, ai: key.ai, value, index: match.index });
    }
  }
  return found;
}

/** A quoted or bare value that is long enough and mixed enough to be a real credential. */
export function looksLikeRealSecret(value: string): boolean {
  const trimmed = value.trim().replace(/^["'`]|["'`]$/g, "");
  if (!trimmed || looksPlaceholder(trimmed) || lowEntropy(trimmed)) return false;
  if (trimmed.length < 16) return false;
  if (/^(?:true|false|null|undefined|yes|no|\d+)$/i.test(trimmed)) return false;
  if (trimmed.startsWith("process.env") || trimmed.startsWith("$")) return false;
  return /\d/.test(trimmed) && /[A-Za-z]/.test(trimmed);
}

export function quotedValue(line: string): string | null {
  const match = line.match(/=\s*["'`]([^"'`]*)["'`]/);
  return match ? match[1] : null;
}

const ignoredCache = new Map<string, boolean>();

/** True when git would not ship this path. A tracked file is not ignored. */
export function isGitIgnored(root: string, relativePath: string): boolean {
  if (!root) return false;
  const key = `${root}\0${relativePath}`;
  const cached = ignoredCache.get(key);
  if (cached !== undefined) return cached;
  let ignored = false;
  try {
    execFileSync("git", ["-C", root, "check-ignore", "-q", "--", relativePath], {
      stdio: "ignore",
      timeout: 3000,
    });
    ignored = true;
  } catch {
    ignored = false;
  }
  ignoredCache.set(key, ignored);
  return ignored;
}

type LexState = "code" | "line" | "block" | "squote" | "dquote" | "template";

export function regionAt(text: string, index: number, kind: ScanLanguage): "code" | "comment" | "string" {
  let state: LexState = "code";
  let i = 0;
  const limit = Math.min(index, text.length);
  while (i < limit) {
    const current = text[i];
    const next = text[i + 1];
    if (state === "line") {
      if (current === "\n") state = "code";
      i += 1;
      continue;
    }
    if (state === "block") {
      if (current === "*" && next === "/") {
        state = "code";
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (state === "squote" || state === "dquote" || state === "template") {
      if (current === "\\") {
        i += 2;
        continue;
      }
      const quote = state === "squote" ? "'" : state === "dquote" ? '"' : "`";
      if (current === quote) state = "code";
      i += 1;
      continue;
    }
    if ((kind === "python" || kind === "sql" || kind === "env") && current === "#") {
      state = "line";
      i += 1;
      continue;
    }
    if (kind === "sql" && current === "-" && next === "-") {
      state = "line";
      i += 2;
      continue;
    }
    if (kind === "javascript" || kind === "sql") {
      if (current === "/" && next === "/") {
        state = "line";
        i += 2;
        continue;
      }
      if (current === "/" && next === "*") {
        state = "block";
        i += 2;
        continue;
      }
    }
    if (current === "'") {
      state = "squote";
      i += 1;
      continue;
    }
    if (current === '"') {
      state = "dquote";
      i += 1;
      continue;
    }
    if ((kind === "javascript" || kind === "sql") && current === "`") {
      state = "template";
      i += 1;
      continue;
    }
    i += 1;
  }
  if (state === "line" || state === "block") return "comment";
  if (state === "squote" || state === "dquote" || state === "template") return "string";
  return "code";
}

export function languageOf(file: SourceFile): ScanLanguage {
  if (file.kind === "sql") return "sql";
  if (file.kind === "env") return "env";
  if (file.language === "python") return "python";
  return "javascript";
}

export function lineHasRegexSource(line: string): boolean {
  return /\\[sSdDwWbBnr]/.test(line) || /\\[()[\]{}|+*?]/.test(line);
}

const IMPORT_SPECIFIER = /(?:import|export)\s+(?:type\s+)?(?:[^"'`;]*?\sfrom\s)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;

export function importSpecifiers(text: string): string[] {
  const specs: string[] = [];
  for (const match of text.matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[1] || match[2] || match[3];
    if (specifier) specs.push(specifier);
  }
  return specs;
}

export function resolveImport(fromFile: string, specifier: string, files: SourceFile[]): SourceFile | null {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return null;
  let base: string;
  if (specifier.startsWith("@/")) {
    base = `src/${specifier.slice(2)}`;
  } else {
    const directory = path.posix.dirname(fromFile.replace(/\\/g, "/"));
    base = path.posix.normalize(path.posix.join(directory === "." ? "" : directory, specifier));
    if (base.startsWith("./")) base = base.slice(2);
  }
  const candidates = [base];
  if (!/\.[cm]?[jt]sx?$/.test(base)) {
    for (const extension of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) candidates.push(base + extension);
    for (const extension of [".ts", ".tsx", ".js", ".mjs"]) candidates.push(`${base}/index${extension}`);
  }
  const byPath = new Map(files.map((file) => [file.relativePath.replace(/\\/g, "/"), file]));
  for (const candidate of candidates) {
    const found = byPath.get(candidate);
    if (found) return found;
  }
  return null;
}

/** The start file plus modules it imports, `depth` hops out. */
export function reachableFiles(start: SourceFile, files: SourceFile[], depth: number): SourceFile[] {
  const seen = new Set<string>([start.relativePath]);
  const related = [start];
  let frontier = [start];
  for (let hop = 0; hop < depth; hop += 1) {
    const next: SourceFile[] = [];
    for (const file of frontier) {
      for (const specifier of importSpecifiers(file.text)) {
        const resolved = resolveImport(file.relativePath, specifier, files);
        if (!resolved || seen.has(resolved.relativePath)) continue;
        seen.add(resolved.relativePath);
        related.push(resolved);
        next.push(resolved);
      }
    }
    frontier = next;
  }
  return related;
}

export function hasCodeSignal(text: string, source: string, kind: ScanLanguage): boolean {
  const expression = new RegExp(source, "gi");
  for (const match of text.matchAll(expression)) {
    if (match.index === undefined) continue;
    if (regionAt(text, match.index, kind) === "comment") continue;
    return true;
  }
  return false;
}

export const SIGNATURE_SIGNAL =
  "constructEvent|timingSafeEqual|createHmac|standardwebhooks|\\bsvix\\b|verifySignature|verify\\w*Webhook|stripe-signature|webhook-signature|x-hub-signature|MissingSignatureError|InvalidSignatureError|webhooks\\.unwrap";

export function reachesSignatureVerification(start: SourceFile, files: SourceFile[]): boolean {
  return reachableFiles(start, files, 2).some((file) => hasCodeSignal(file.text, SIGNATURE_SIGNAL, languageOf(file)));
}
