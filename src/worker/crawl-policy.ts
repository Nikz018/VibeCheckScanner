import { isActionUrl } from "./readonly";

/** Paid full scans crawl further than a free teaser or a mini scan. */
export interface CrawlBudget {
  maxPages: number;
  maxRequests: number;
  maxMs: number;
  maxScripts: number;
  maxScriptsPerPage: number;
  maxInlineScripts: number;
  maxSitemaps: number;
  maxQueryVariants: number;
}

const PAID_BUDGET: CrawlBudget = {
  maxPages: 25,
  maxRequests: 100,
  maxMs: 45_000,
  maxScripts: 40,
  maxScriptsPerPage: 20,
  maxInlineScripts: 40,
  maxSitemaps: 8,
  maxQueryVariants: 3,
};

const FREE_BUDGET: CrawlBudget = {
  maxPages: 5,
  maxRequests: 40,
  maxMs: 20_000,
  maxScripts: 16,
  maxScriptsPerPage: 16,
  maxInlineScripts: 20,
  maxSitemaps: 4,
  maxQueryVariants: 3,
};

export function crawlBudget(mode: "full" | "mini", reportAccess: "teaser" | "full"): CrawlBudget {
  if (mode === "full" && reportAccess === "full") return PAID_BUDGET;
  return FREE_BUDGET;
}

/** Scheme, host, and port. Subdomains and other ports are different origins. */
export function isVerifiedOrigin(candidate: string, origin: string): boolean {
  try {
    return new URL(candidate).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

const PAGE_FILE =
  /\.(?:png|jpe?g|gif|svg|ico|webp|avif|bmp|tiff?|mp4|webm|mp3|wav|ogg|mov|avi|mkv|pdf|zip|gz|tgz|tar|rar|7z|bz2|dmg|exe|wasm|bin|woff2?|ttf|otf|eot|css|map|csv|xlsx?|docx?|pptx?|apk|iso|deb|rpm|jar|class|mjs|cjs|js)$/i;

const NON_SCRIPT_FILE =
  /\.(?:png|jpe?g|gif|svg|ico|webp|avif|bmp|tiff?|mp4|webm|mp3|wav|ogg|mov|avi|mkv|pdf|zip|gz|tgz|tar|rar|7z|bz2|dmg|exe|wasm|bin|woff2?|ttf|otf|eot|css|map|csv|xlsx?|docx?|pptx?|apk|iso|deb|rpm|jar|class)$/i;

export function isSkippedPublicFile(url: string): boolean {
  try {
    return PAGE_FILE.test(new URL(url).pathname);
  } catch {
    return true;
  }
}

export function isNonScriptAsset(url: string): boolean {
  try {
    return NON_SCRIPT_FILE.test(new URL(url).pathname);
  } catch {
    return true;
  }
}

export function isHtmlDocument(contentType: string | undefined, body: string): boolean {
  const type = (contentType || "").toLowerCase();
  if (type.includes("text/html") || type.includes("application/xhtml+xml")) return true;
  if (
    type.includes("javascript") ||
    type.includes("json") ||
    type.startsWith("image/") ||
    type.startsWith("video/") ||
    type.startsWith("audio/") ||
    type.startsWith("font/")
  ) {
    return false;
  }
  if (type && !type.startsWith("text/") && !type.includes("xml")) return false;
  return /<!doctype html|<html[\s>]|<a\s[^>]*href=/i.test(body.slice(0, 2000));
}

export function isBinaryResponse(contentType: string | undefined, contentDisposition: string | undefined): boolean {
  if (contentDisposition && /attachment/i.test(contentDisposition)) return true;
  const type = (contentType || "").toLowerCase();
  if (!type) return false;
  if (type.startsWith("image/") || type.startsWith("video/") || type.startsWith("audio/") || type.startsWith("font/")) return true;
  return /application\/(?:pdf|zip|gzip|octet-stream|wasm|x-tar|x-7z-compressed|vnd\.|msword|octet)/i.test(type);
}

export function normalizePublicUrl(raw: string, base: string): string | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  url.hash = "";
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  const params = [...url.searchParams.entries()].sort((left, right) => {
    if (left[0] === right[0]) return left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0;
    return left[0] < right[0] ? -1 : 1;
  });
  url.search = "";
  for (const [key, value] of params) url.searchParams.append(key, value);
  return url.toString();
}

/** Drops fragments, sorts query keys, and stops collecting extra query strings for one path. */
export class UrlDeduper {
  private seen = new Set<string>();
  private variants = new Map<string, number>();

  constructor(private readonly maxQueryVariants: number) {}

  accept(normalized: string): boolean {
    if (this.seen.has(normalized)) return false;
    let url: URL;
    try {
      url = new URL(normalized);
    } catch {
      return false;
    }
    const pathKey = `${url.origin}${url.pathname}`;
    if (url.search) {
      const count = this.variants.get(pathKey) ?? 0;
      if (count >= this.maxQueryVariants) return false;
      this.variants.set(pathKey, count + 1);
    }
    this.seen.add(normalized);
    return true;
  }
}

export function extractAnchorHrefs(html: string): string[] {
  const hrefs: string[] = [];
  const pattern = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
  for (const match of html.matchAll(pattern)) {
    const raw = decodeHtmlAttr(match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!raw || raw.startsWith("#")) continue;
    if (/^(?:javascript|mailto|tel|data|blob):/i.test(raw)) continue;
    hrefs.push(raw);
  }
  return hrefs;
}

function decodeHtmlAttr(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export interface RobotsRules {
  allow: string[];
  disallow: string[];
  sitemaps: string[];
}

export function parseRobots(text: string, userAgent: string): RobotsRules {
  const groups: Array<{ agents: string[]; allow: string[]; disallow: string[] }> = [];
  const sitemaps: string[] = [];
  let current: { agents: string[]; allow: string[]; disallow: string[] } | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const splitAt = line.indexOf(":");
    if (splitAt < 0) continue;
    const key = line.slice(0, splitAt).trim().toLowerCase();
    const value = line.slice(splitAt + 1).trim();
    if (key === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (key === "user-agent") {
      if (!current || current.allow.length > 0 || current.disallow.length > 0) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (!current) continue;
    if (key === "allow" && value) current.allow.push(value);
    if (key === "disallow" && value) current.disallow.push(value);
  }

  const ua = userAgent.toLowerCase();
  const product = ua.split(/[\s/]/)[0] ?? "";
  const matchesAgent = (agent: string) => {
    if (!agent || agent === "*") return false;
    return ua.startsWith(agent) || product === agent || product.startsWith(agent);
  };
  const specific = groups.filter((group) => group.agents.some(matchesAgent));
  const chosen = specific.length > 0 ? specific : groups.filter((group) => group.agents.includes("*"));
  return {
    allow: chosen.flatMap((group) => group.allow),
    disallow: chosen.flatMap((group) => group.disallow),
    sitemaps,
  };
}

export function robotsAllows(url: string, rules: RobotsRules): boolean {
  let path = "/";
  try {
    const parsed = new URL(url);
    path = `${parsed.pathname}${parsed.search}`;
  } catch {
    return false;
  }
  let best = -1;
  let allowed = true;
  const consider = (pattern: string, allow: boolean) => {
    const length = robotsMatchLength(pattern, path);
    if (length < 0) return;
    if (length > best || (length === best && allow)) {
      best = length;
      allowed = allow;
    }
  };
  for (const pattern of rules.disallow) consider(pattern, false);
  for (const pattern of rules.allow) consider(pattern, true);
  return allowed;
}

function robotsMatchLength(pattern: string, path: string): number {
  if (!pattern) return -1;
  const endAnchored = pattern.endsWith("$");
  const core = endAnchored ? pattern.slice(0, -1) : pattern;
  const source = `^${core.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}${endAnchored ? "$" : ""}`;
  if (!new RegExp(source).test(path)) return -1;
  return core.length;
}

export function parseSitemapXml(xml: string): { pages: string[]; sitemaps: string[] } {
  const pages: string[] = [];
  const sitemaps: string[] = [];
  const index = /<sitemapindex[\s>]/i.test(xml);
  for (const match of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    const value = decodeXml(match[1] ?? "");
    if (!value) continue;
    if (index) sitemaps.push(value);
    else pages.push(value);
  }
  return { pages, sitemaps };
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .trim();
}

const MIXED_RESOURCE =
  /<(script|img|iframe|audio|video|source|object|embed|link|form)\b[^>]*>/gi;

export function findMixedContent(pageUrl: string, html: string): string[] {
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return [];
  }
  if (page.protocol !== "https:") return [];
  const found: string[] = [];
  for (const match of html.matchAll(MIXED_RESOURCE)) {
    const tag = match[0] ?? "";
    const name = (match[1] ?? "").toLowerCase();
    if (name === "link" && !/rel\s*=\s*["']?stylesheet/i.test(tag)) continue;
    const attr = name === "form" ? "action" : name === "object" ? "data" : name === "link" ? "href" : "src";
    const raw = readAttr(tag, attr);
    if (!raw) continue;
    try {
      const target = new URL(raw, page);
      if (target.protocol === "http:") found.push(target.toString());
    } catch {
      // ignore malformed resource URLs
    }
  }
  return [...new Set(found)];
}

export interface FormIssue {
  action: string;
  reason: "https-downgrade" | "cross-origin" | "password-over-http";
}

export function findFormIssues(pageUrl: string, html: string): FormIssue[] {
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return [];
  }
  const issues: FormIssue[] = [];
  for (const match of html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)) {
    const block = match[0] ?? "";
    const tag = block.match(/<form\b[^>]*>/i)?.[0] ?? "";
    const rawAction = readAttr(tag, "action") || pageUrl;
    let action: URL;
    try {
      action = new URL(rawAction, page);
    } catch {
      continue;
    }
    if (action.protocol !== "http:" && action.protocol !== "https:") continue;
    const hasPassword = /<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(block);
    let reason: FormIssue["reason"] | null = null;
    if (page.protocol === "https:" && action.protocol === "http:") reason = "https-downgrade";
    else if (action.origin !== page.origin) reason = "cross-origin";
    else if (hasPassword && action.protocol === "http:") reason = "password-over-http";
    if (!reason) continue;
    issues.push({ action: action.toString(), reason });
  }
  return issues;
}

function readAttr(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, "i"));
  return decodeHtmlAttr(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

/** Normalized same-origin page URL, or null when the crawl must not fetch it. */
export function classifyDiscoveredUrl(raw: string, base: string, origin: string, rules: RobotsRules): string | null {
  const normalized = normalizePublicUrl(raw, base);
  if (!normalized || !isVerifiedOrigin(normalized, origin)) return null;
  if (isActionUrl(normalized) || isSkippedPublicFile(normalized)) return null;
  if (!robotsAllows(normalized, rules)) return null;
  return normalized;
}

export function pathAndQuery(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}
