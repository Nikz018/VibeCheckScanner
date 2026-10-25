import type { Metadata } from "next";
import Link from "next/link";
import { PricingCards, PublicArticle, QaSection, TaxLine } from "@/components/Marketing";
import { PRICING_SECTIONS } from "@/lib/seo/content";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata("pricing");

export default function PricingPage() {
  return (
    <PublicArticle pageId="pricing" width="wide">
      <PricingCards titles="text" />
      <TaxLine />
      {PRICING_SECTIONS.map((section) => (
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
