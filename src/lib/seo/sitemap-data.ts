import type { MetadataRoute } from "next";
import { PUBLIC_PAGES } from "./content";
import { absoluteUrl } from "./site";

const TEXT_FILES = ["/llms.txt", "/llms-full.txt"];

export function sitemapEntries(): MetadataRoute.Sitemap {
  const pages = PUBLIC_PAGES.map((page) => ({
    url: absoluteUrl(page.path),
    lastModified: new Date(),
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
  const extras = TEXT_FILES.map((path) => ({
    url: absoluteUrl(path),
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.4,
  }));
  return [...pages, ...extras];
}
