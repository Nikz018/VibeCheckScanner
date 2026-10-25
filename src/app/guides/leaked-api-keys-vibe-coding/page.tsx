import type { Metadata } from "next";
import { GuideArticle } from "@/components/Marketing";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata("guide-keys");

export default function LeakedKeysGuidePage() {
  return <GuideArticle pageId="guide-keys" />;
}
