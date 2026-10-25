import type { Metadata } from "next";
import { PublicArticle, QaSection } from "@/components/Marketing";
import { LEGAL_SECTIONS } from "@/lib/seo/content";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata("terms");

export default function TermsPage() {
  return (
    <PublicArticle pageId="terms">
      {LEGAL_SECTIONS.terms.map((section) => (
        <QaSection key={section.heading} {...section} />
      ))}
    </PublicArticle>
  );
}
