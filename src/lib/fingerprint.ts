import { compareVersions } from "./advisories";
import type { Confidence } from "./report";

export type VersionSource = "package_json" | "script_url" | "banner" | "global" | "header" | "next_data";

export interface VersionEvidence {
  url: string;
  snippet: string;
  source: VersionSource;
  pageUrl?: string;
}

export interface DetectedPackage {
  name: string;
  version: string;
  confidence: Confidence;
  evidence: VersionEvidence[];
}

export interface FingerprintPage {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface FingerprintScript {
  url: string;
  body: string;
  pageUrls?: string[];
}

export interface FingerprintInput {
  pages: FingerprintPage[];
  scripts: FingerprintScript[];
  packageJson?: string | null;
  packageJsonUrl?: string | null;
}

const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const MAX_EVIDENCE = 4;
const MAX_DETECTIONS = 80;
const BLOCKED_NAMES = new Set([
  "npm",
  "node",
  "dist",
  "umd",
  "static",
  "chunks",
  "assets",
  "js",
  "css",
  "min",
  "bundle",
  "vendor",
  "public",
  "app",
  "index",
  "main",
  "polyfills",
]);

const ALIASES: Record<string, string> = {
  "angular.js": "angular",
  angularjs: "angular",
  "lodash.js": "lodash",
  "moment.js": "moment",
  "vue.js": "vue",
  "react.js": "react",
  "react-dom.js": "react-dom",
  "jquery.js": "jquery",
  "bootstrap.js": "bootstrap",
  "axios.js": "axios",
};

const TEXT_RULES: Array<{ name: string; pattern: RegExp; confidence: Confidence; source: VersionSource }> = [
  { name: "jquery", pattern: /jQuery(?:\s+JavaScript Library)?\s+v(\d+\.\d+\.\d+)/i, confidence: "high", source: "banner" },
  { name: "lodash", pattern: /@license\s+Lodash\s+v?(\d+\.\d+\.\d+)/i, confidence: "high", source: "banner" },
  { name: "lodash", pattern: /\bLodash\s+v(\d+\.\d+\.\d+)/, confidence: "high", source: "banner" },
  { name: "moment", pattern: /moment\.js[\s\S]{0,120}?version\s*:\s*(\d+\.\d+\.\d+)/i, confidence: "high", source: "banner" },
  { name: "bootstrap", pattern: /Bootstrap\s+v(\d+\.\d+\.\d+)/, confidence: "high", source: "banner" },
  { name: "vue", pattern: /Vue(?:\.js)?\s+v(\d+\.\d+\.\d+)/, confidence: "high", source: "banner" },
  { name: "vue", pattern: /Vue\.version\s*=\s*["'](\d+\.\d+\.\d+)["']/, confidence: "high", source: "global" },
  { name: "axios", pattern: /\baxios\s+v(\d+\.\d+\.\d+)/i, confidence: "high", source: "banner" },
  { name: "react", pattern: /@license\s+React\s+v(\d+\.\d+\.\d+)/i, confidence: "high", source: "banner" },
  { name: "react", pattern: /\bReact\s+v(\d+\.\d+\.\d+)/, confidence: "high", source: "banner" },
  { name: "react", pattern: /React\.version\s*=\s*["'](\d+\.\d+\.\d+)["']/, confidence: "high", source: "global" },
  { name: "@angular/core", pattern: /@license\s+Angular\s+v(\d+\.\d+\.\d+)/i, confidence: "high", source: "banner" },
  { name: "angular", pattern: /AngularJS\s+v(\d+\.\d+\.\d+)/i, confidence: "high", source: "banner" },
  { name: "angular", pattern: /angular\.version\s*=\s*\{[^}]{0,120}["']full["']\s*:\s*["'](\d+\.\d+\.\d+)["']/i, confidence: "high", source: "global" },
  { name: "next", pattern: /Next\.js\s+v?(\d+\.\d+\.\d+)/i, confidence: "high", source: "banner" },
  { name: "next", pattern: /__NEXT_VERSION["']?\s*[:=]\s*["'](\d+\.\d+\.\d+)["']/, confidence: "high", source: "global" },
];

type Adder = (name: string, version: string, confidence: Confidence, evidence: VersionEvidence) => void;

export function normalizePackageName(name: string): string | null {
  const lower = name.trim().toLowerCase();
  if (!/^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(lower)) return null;
  if (lower.length > 214) return null;
  const aliased = ALIASES[lower] ?? lower;
  if (!aliased.startsWith("@") && BLOCKED_NAMES.has(aliased)) return null;
  return aliased;
}

export function fingerprintDependencies(input: FingerprintInput): DetectedPackage[] {
  const found = new Map<string, DetectedPackage>();
  const add: Adder = (name, version, confidence, evidence) => {
    const normalized = normalizePackageName(name);
    if (!normalized || !VERSION.test(version)) return;
    if (!evidence.url.startsWith("http://") && !evidence.url.startsWith("https://")) return;
    const key = `${normalized}@${version}`;
    const snippet = clipSnippet(evidence.snippet);
    const next: VersionEvidence = { ...evidence, snippet, ...(evidence.pageUrl ? { pageUrl: evidence.pageUrl } : {}) };
    const existing = found.get(key);
    if (!existing) {
      found.set(key, { name: normalized, version, confidence, evidence: [next] });
      return;
    }
    if (confidenceRank(confidence) > confidenceRank(existing.confidence)) existing.confidence = confidence;
    if (existing.evidence.length >= MAX_EVIDENCE) return;
    if (existing.evidence.some((item) => item.url === next.url && item.snippet === next.snippet && item.source === next.source)) return;
    existing.evidence.push(next);
  };

  for (const page of input.pages) {
    if (!page.url.startsWith("http")) continue;
    scanPage(page, add);
  }
  for (const script of input.scripts) scanScript(script, add);
  if (input.packageJson && input.packageJsonUrl) scanManifest(input.packageJson, input.packageJsonUrl, add);

  return [...found.values()]
    .sort((left, right) => {
      const byConfidence = confidenceRank(right.confidence) - confidenceRank(left.confidence);
      if (byConfidence !== 0) return byConfidence;
      const byName = left.name.localeCompare(right.name);
      if (byName !== 0) return byName;
      return compareVersions(left.version, right.version);
    })
    .slice(0, MAX_DETECTIONS);
}

function confidenceRank(confidence: Confidence): number {
  if (confidence === "high") return 3;
  if (confidence === "medium") return 2;
  return 1;
}

function clipSnippet(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 160);
}

function scanPage(page: FingerprintPage, add: Adder): void {
  let pageNext: string | null = null;
  const rememberNext = (version: string) => {
    pageNext = version;
  };

  const powered = headerValue(page.headers, "x-powered-by");
  const nextHeader = nextHeaderVersion(powered);
  if (nextHeader.version) {
    add("next", nextHeader.version, "high", {
      url: page.url,
      pageUrl: page.url,
      source: "header",
      snippet: `x-powered-by: ${clipSnippet(powered)}`,
    });
    rememberNext(nextHeader.version);
  }

  const generated = generatorNextVersion(page.body);
  if (generated) {
    add("next", generated, "high", {
      url: page.url,
      pageUrl: page.url,
      source: "banner",
      snippet: `generator: Next.js ${generated}`,
    });
    rememberNext(generated);
  }

  const nextData = nextDataVersion(page.body);
  if (nextData) {
    add("next", nextData.version, "high", {
      url: page.url,
      pageUrl: page.url,
      source: "next_data",
      snippet: nextData.snippet,
    });
    rememberNext(nextData.version);
  }

  if (nextHeader.mentioned && !nextHeader.version && pageNext) {
    add("next", pageNext, "high", {
      url: page.url,
      pageUrl: page.url,
      source: "header",
      snippet: `x-powered-by: ${clipSnippet(powered)}`,
    });
  }

  for (const url of assetUrls(page.body, page.url)) noteScriptUrl(url, page.url, add);
}

function scanScript(script: FingerprintScript, add: Adder): void {
  const pageUrl = script.pageUrls?.find((url) => url.startsWith("http://") || url.startsWith("https://"));
  if (script.url.startsWith("http://") || script.url.startsWith("https://")) noteScriptUrl(script.url, pageUrl, add);
  const body = script.body.length > 500_000 ? script.body.slice(0, 500_000) : script.body;
  const windows = body.length <= 24_000 ? [body] : [body.slice(0, 20_000), body.slice(-4_000)];
  for (const window of windows) {
    for (const rule of TEXT_RULES) {
      const match = window.match(rule.pattern);
      if (!match?.[1] || match.index === undefined) continue;
      const url = httpUrl(script.url, pageUrl);
      if (!url) continue;
      add(rule.name, match[1], rule.confidence, {
        url,
        pageUrl,
        source: rule.source,
        snippet: clipSnippet(window.slice(Math.max(0, match.index - 30), match.index + match[0].length + 30)),
      });
    }
  }
  const marker = body.indexOf("__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED");
  if (marker >= 0) {
    const start = Math.max(0, marker - 300);
    const window = body.slice(start, marker + 300);
    const match = window.match(/\.version\s*=\s*["'](\d+\.\d+\.\d+)["']/);
    const url = httpUrl(script.url, pageUrl);
    if (match?.[1] && url) {
      add("react", match[1], "medium", {
        url,
        pageUrl,
        source: "global",
        snippet: clipSnippet(match[0]),
      });
    }
  }
  const embedded = body.match(/https?:\/\/[^\s"'<>)\\]+/g) ?? [];
  for (const raw of embedded.slice(0, 30)) noteScriptUrl(raw.replace(/[),.;]+$/, ""), pageUrl, add);
}

function scanManifest(raw: string, manifestUrl: string, add: Adder): void {
  let parsed: {
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
    optionalDependencies?: Record<string, unknown>;
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return;
  }
  const groups: Array<[Record<string, unknown> | undefined, Confidence]> = [
    [parsed.dependencies, "high"],
    [parsed.optionalDependencies, "medium"],
    [parsed.devDependencies, "medium"],
  ];
  for (const [group, base] of groups) {
    if (!group) continue;
    for (const [name, value] of Object.entries(group)) {
      if (typeof value !== "string") continue;
      const concrete = concreteVersion(value);
      if (!concrete) continue;
      const confidence: Confidence = concrete.ranged ? (base === "high" ? "medium" : "low") : base;
      const declared = concrete.ranged ? `"${name}": "${value}" (checked ${concrete.version})` : `"${name}": "${value}"`;
      add(name, concrete.version, confidence, {
        url: manifestUrl,
        pageUrl: manifestUrl,
        source: "package_json",
        snippet: declared,
      });
    }
  }
}

function concreteVersion(raw: string): { version: string; ranged: boolean } | null {
  const trimmed = raw.trim();
  if (!trimmed || /^(?:\*|latest|workspace:|file:|link:|portal:|git\+|github:|http:|https:)/i.test(trimmed)) return null;
  const exact = trimmed.match(/^v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/i);
  if (exact) return { version: exact[1], ranged: false };
  const aliased = trimmed.match(/^npm:[^@]+@(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/i);
  if (aliased) return { version: aliased[1], ranged: false };
  const range = trimmed.match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
  if (!range) return null;
  return { version: range[1], ranged: true };
}

function noteScriptUrl(url: string, pageUrl: string | undefined, add: Adder): void {
  if (!url.startsWith("http://") && !url.startsWith("https://")) return;
  for (const hit of versionsFromUrl(url)) {
    add(hit.name, hit.version, "high", {
      url,
      pageUrl,
      source: "script_url",
      snippet: `${hit.name}@${hit.version}`,
    });
  }
}

function versionsFromUrl(url: string): Array<{ name: string; version: string }> {
  const found: Array<{ name: string; version: string }> = [];
  const add = (name: string, version: string) => {
    const normalized = normalizePackageName(name);
    if (!normalized || !VERSION.test(version)) return;
    if (found.some((item) => item.name === normalized && item.version === version)) return;
    found.push({ name: normalized, version });
  };
  for (const match of url.matchAll(/\/(@[a-z0-9][a-z0-9._-]*\/)?([a-z0-9][a-z0-9._-]*)@(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?=\/|$|\?|#)/gi)) {
    add(`${match[1] ?? ""}${match[2]}`, match[3]);
  }
  for (const match of url.matchAll(/\/ajax\/libs\/([a-z0-9_.-]+)\/(\d+\.\d+\.\d+)(?=\/|$|\?|#)/gi)) {
    add(match[1], match[2]);
  }
  const file = url.match(/\/(react-dom|jquery|lodash|moment|bootstrap|vue|axios|react|angular)(?:\.min)?-(\d+\.\d+\.\d+)(?:\.min)?\.js(?=$|\?|#)/i);
  if (file) add(file[1], file[2]);
  const directory = url.match(/\/(react-dom|jquery|lodash|moment|bootstrap|vue|axios|react|angularjs|angular)\/(\d+\.\d+\.\d+)\//i);
  if (directory) add(directory[1], directory[2]);
  return found;
}

function assetUrls(html: string, pageUrl: string): string[] {
  const found: string[] = [];
  for (const tag of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const element = tag[0];
    const kind = tag[1].toLowerCase();
    const raw = readAttr(element, kind === "script" ? "src" : "href");
    if (!raw) continue;
    if (kind === "link" && !/[@]|\/ajax\/libs\/|\.(?:m?js|css)(?:$|\?)/i.test(raw)) continue;
    const absolute = resolveHttp(raw, pageUrl);
    if (!absolute) continue;
    found.push(absolute);
    if (found.length >= 40) break;
  }
  return found;
}

function readAttr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  const value = match?.[1] ?? match?.[2];
  if (!value) return null;
  return value.replace(/&amp;/g, "&").trim();
}

function resolveHttp(raw: string, base: string): string | null {
  if (/^(?:data|javascript|mailto):/i.test(raw)) return null;
  try {
    const url = new URL(raw, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function httpUrl(url: string, pageUrl: string | undefined): string | null {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (pageUrl && (pageUrl.startsWith("http://") || pageUrl.startsWith("https://"))) return pageUrl;
  return null;
}

function headerValue(headers: Record<string, string>, name: string): string {
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (direct) return direct;
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return found?.[1] ?? "";
}

function nextHeaderVersion(value: string): { mentioned: boolean; version: string | null } {
  if (!/next\.js/i.test(value)) return { mentioned: false, version: null };
  const match = value.match(/next\.js(?:\s*[/\s]\s*v?)?\s*(\d+\.\d+\.\d+)?/i);
  return { mentioned: true, version: match?.[1] ?? null };
}

function generatorNextVersion(html: string): string | null {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const name = readAttr(tag[0], "name");
    if (name?.toLowerCase() !== "generator") continue;
    const content = readAttr(tag[0], "content") ?? "";
    const match = content.match(/next\.js\s+v?(\d+\.\d+\.\d+)/i);
    if (match) return match[1];
  }
  return null;
}

function nextDataVersion(html: string): { version: string; snippet: string } | null {
  const match = html.match(/<script\b[^>]*\bid\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  const version = match[1].match(/"nextVersion"\s*:\s*"(\d+\.\d+\.\d+)"/);
  if (!version) return null;
  return { version: version[1], snippet: version[0] };
}
