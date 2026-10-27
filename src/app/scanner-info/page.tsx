import type { Metadata } from "next";
import { PublicArticle, QaSection } from "@/components/Marketing";
import { abuseContactEmail } from "@/lib/scanner-identity";
import { SCANNER_INFO_SECTIONS } from "@/lib/seo/content";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata("scanner-info");

export default function ScannerInfoPage() {
  const email = abuseContactEmail();
  return (
    <PublicArticle pageId="scanner-info">
      <p>
        {email ? (
          <>
            Report unwanted scans to{" "}
            <a className="text-lime" href={`mailto:${email}`}>
              {email}
            </a>
            .
          </>
        ) : (
          <>This server has not published an abuse email yet. Use the contact page, put abuse report in the subject, and include the time and the URL.</>
        )}
      </p>
      {SCANNER_INFO_SECTIONS.map((section) => (
        <QaSection key={section.heading} {...section} />
      ))}
    </PublicArticle>
  );
}
