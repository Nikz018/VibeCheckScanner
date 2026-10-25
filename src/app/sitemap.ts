import type { MetadataRoute } from "next";
import { sitemapEntries } from "../lib/seo/sitemap-data";

export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries();
}
