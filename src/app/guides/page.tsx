import type { Metadata } from "next";
import Link from "next/link";
import { PublicArticle } from "@/components/Marketing";
import { getPublicPage, type PublicPageId } from "@/lib/seo/content";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata("guides");

const GUIDE_IDS: PublicPageId[] = ["guide-lovable", "guide-rls", "guide-keys"];

export default function GuidesPage() {
  return (
    <PublicArticle pageId="guides">
      {GUIDE_IDS.map((id) => {
        const page = getPublicPage(id);
        return (
          <section key={id}>
            <h2 className="font-display text-3xl leading-tight">
              <Link href={page.path}>{page.h1}</Link>
            </h2>
            <p className="mt-3 text-[#ddd6c8]">{page.lede}</p>
          </section>
        );
      })}
    </PublicArticle>
  );
}
