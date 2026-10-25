import type { Metadata } from "next";
import Link from "next/link";
import { FaqList, PublicArticle } from "@/components/Marketing";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata("faq");

export default function FaqPage() {
  return (
    <PublicArticle pageId="faq">
      <FaqList />
      <p className="flex flex-wrap gap-3">
        <Link href="/pricing" className="btn btn-ghost">
          Pricing
        </Link>
        <Link href="/how-it-works" className="btn btn-ghost">
          How it works
        </Link>
        <Link href="/scans/new" className="btn btn-lime">
          Scan an app you own
        </Link>
      </p>
    </PublicArticle>
  );
}
