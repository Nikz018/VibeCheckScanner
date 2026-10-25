import type { MetadataRoute } from "next";
import { absoluteUrl, getSiteUrl } from "./site";

/**
 * Search crawlers and the AI crawlers we want to cite VibeCheck.
 * A named user-agent group does not inherit rules from `*`, so every agent repeats the same allow and disallow lists.
 *
 * /share/ stays allowed. That route 404s unless the owner opted in, and the page shows the score and date only.
 * Private scan results live under /scans.
 */
export const SEARCH_CRAWLERS = ["Googlebot", "Bingbot", "Applebot"] as const;

export const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "ClaudeBot",
  "Google-Extended",
  "Applebot-Extended",
  "Bingbot",
] as const;

export const ROBOTS_DISALLOW = ["/dashboard", "/api", "/scans", "/login", "/check"] as const;

export function isPathDisallowed(input: string): boolean {
  const path = input.startsWith("http") ? new URL(input).pathname : input.split("?")[0] || "/";
  return ROBOTS_DISALLOW.some((prefix) => path === prefix || path.startsWith(prefix));
}

export function robotsPolicy(): MetadataRoute.Robots {
  const userAgents = ["*", ...SEARCH_CRAWLERS, ...AI_CRAWLERS];
  const unique = [...new Set<string>(userAgents)];
  return {
    rules: unique.map((userAgent) => ({
      userAgent,
      allow: "/",
      disallow: [...ROBOTS_DISALLOW],
    })),
    sitemap: absoluteUrl("/sitemap.xml"),
    host: getSiteUrl(),
  };
}
