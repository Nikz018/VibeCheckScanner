import type { Metadata } from "next";
import { PublicArticle, QaSection } from "@/components/Marketing";
import { LEGAL_SECTIONS } from "@/lib/seo/content";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata("refund");

export default function RefundPage() {
  return (
    <PublicArticle pageId="refund">
      {LEGAL_SECTIONS.refund.map((section) => (
        <QaSection key={section.heading} {...section} />
      ))}
    </PublicArticle>
  );
}
