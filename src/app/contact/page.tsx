import type { Metadata } from "next";
import { ContactEmail, PublicArticle, QaSection } from "@/components/Marketing";
import { LEGAL_SECTIONS } from "@/lib/seo/content";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata("contact");

export default function ContactPage() {
  return (
    <PublicArticle pageId="contact">
      <ContactEmail />
      {LEGAL_SECTIONS.contact.map((section) => (
        <QaSection key={section.heading} {...section} />
      ))}
    </PublicArticle>
  );
}
