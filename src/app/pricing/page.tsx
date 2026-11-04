import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PricingCheckout } from "@/components/PricingCheckout";
import { PublicArticle, QaSection, TaxLine } from "@/components/Marketing";
import { readSession } from "@/lib/auth";
import { pricingCheckoutPath, signInPath, tierFromCheckoutParam } from "@/lib/checkout-path";
import { monitoringActive } from "@/lib/entitlements";
import { collectsBillingAddress } from "@/lib/payments";
import { PRICING_SECTIONS } from "@/lib/seo/content";
import { pageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata("pricing");

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const params = await searchParams;
  const session = await readSession();
  const user = session.status === "active" ? session.user : null;
  const tier = tierFromCheckoutParam(params.checkout);
  if (tier && session.status === "expired") redirect(signInPath(pricingCheckoutPath(tier), { expired: true }));
  return (
    <PublicArticle pageId="pricing" width="wide">
      <PricingCheckout
        signedIn={Boolean(user)}
        sessionExpired={session.status === "expired"}
        collectBilling={collectsBillingAddress()}
        initialTier={tier}
        monitoring={monitoringActive(user?.subscription?.status)}
      />
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
