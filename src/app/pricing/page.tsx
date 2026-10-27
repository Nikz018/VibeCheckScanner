import type { Metadata } from "next";
import Link from "next/link";
import { PricingCheckout } from "@/components/PricingCheckout";
import { PublicArticle, QaSection, TaxLine } from "@/components/Marketing";
import { getCurrentUser } from "@/lib/auth";
import { tierFromCheckoutParam } from "@/lib/checkout-path";
import { collectsBillingAddress } from "@/lib/payments";
import { PRICING_SECTIONS } from "@/lib/seo/content";
import { pageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata("pricing");

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const params = await searchParams;
  const user = await getCurrentUser();
  return (
    <PublicArticle pageId="pricing" width="wide">
      <PricingCheckout signedIn={Boolean(user)} collectBilling={collectsBillingAddress()} initialTier={tierFromCheckoutParam(params.checkout)} />
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
