import type { Metadata } from "next";
import { GuideArticle } from "@/components/Marketing";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata("guide-rls");

export default function SupabaseRlsGuidePage() {
  return <GuideArticle pageId="guide-rls" />;
}
