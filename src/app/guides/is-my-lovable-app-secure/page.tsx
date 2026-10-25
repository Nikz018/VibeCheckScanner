import type { Metadata } from "next";
import { GuideArticle } from "@/components/Marketing";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata("guide-lovable");

export default function LovableGuidePage() {
  return <GuideArticle pageId="guide-lovable" />;
}
