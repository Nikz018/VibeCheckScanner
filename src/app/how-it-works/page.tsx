import type { Metadata } from "next";
import Link from "next/link";
import { PublicArticle, QaSection } from "@/components/Marketing";
import { OWNERSHIP_GUIDE_LINK_LABEL, OWNERSHIP_GUIDE_PATH } from "@/lib/ownership-guide";
import { HOW_TO_EXTRAS, HOW_TO_STEPS } from "@/lib/seo/content";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata("how-it-works");

export default function HowItWorksPage() {
  return (
    <PublicArticle pageId="how-it-works">
      <ol className="list-none space-y-10 p-0">
        {HOW_TO_STEPS.map((step, index) => (
          <li key={step.heading} id={`step-${index + 1}`} className="scroll-mt-24">
            <h2 className="font-display text-3xl leading-tight">{step.heading}</h2>
            {step.paragraphs.map((paragraph, paragraphIndex) => (
              <p key={`${step.heading}-${paragraphIndex}`} className="mt-3 text-[#ddd6c8]">
                {paragraph}
              </p>
            ))}
            {step.heading === "How do I prove I own the origin?" ? (
              <p className="mt-3">
                <Link className="text-lime underline" href={OWNERSHIP_GUIDE_PATH}>
                  {OWNERSHIP_GUIDE_LINK_LABEL}
                </Link>
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      {HOW_TO_EXTRAS.map((section) => (
        <QaSection key={section.heading} {...section} />
      ))}
      <p>
        <Link href="/scans/new" className="btn btn-lime">
          Scan an app you own
        </Link>
      </p>
    </PublicArticle>
  );
}
