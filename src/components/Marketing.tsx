import Link from "next/link";
import { abuseContactEmail } from "@/lib/scanner-identity";
import {
  CONTACT_EMAIL_PLACEHOLDER,
  FAQ,
  GUIDES,
  ISSUE_CHECKS,
  LEGAL_REVIEW_NOTE,
  breadcrumbsFor,
  getPublicPage,
  type CopyBlock,
  type PublicPageId,
} from "@/lib/seo/content";
import { jsonLdForPage } from "@/lib/seo/jsonld";
import { FREE_TIER, TAX_NOTE, TIERS } from "@/lib/pricing";

export function JsonLd({ data }: { data: unknown }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}

export function ReviewNote() {
  return (
    <p role="note" className="mt-6 rounded-2xl border border-[#ead98a] bg-[#fff7d4] px-4 py-3 text-sm text-ink">
      {LEGAL_REVIEW_NOTE}
    </p>
  );
}

export function Breadcrumbs({ id }: { id: PublicPageId }) {
  const items = breadcrumbsFor(id);
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-[#b7b1a4]">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.path}-${item.name}`} className="flex items-center gap-2">
              {index > 0 ? <span aria-hidden="true">/</span> : null}
              {last ? <span aria-current="page">{item.name}</span> : <Link href={item.path}>{item.name}</Link>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function PublicArticle({
  pageId,
  width = "narrow",
  children,
}: {
  pageId: PublicPageId;
  width?: "narrow" | "wide";
  children: React.ReactNode;
}) {
  const page = getPublicPage(pageId);
  const frame = width === "wide" ? "max-w-6xl" : "max-w-3xl";
  return (
    <article className={`${frame} pb-16`}>
      <Breadcrumbs id={pageId} />
      {page.review ? <ReviewNote /> : null}
      <h1 className="mt-6 font-display text-5xl leading-[1.05] md:text-6xl">{page.h1}</h1>
      <p className="mt-5 text-lg text-[#ddd6c8]">{page.lede}</p>
      <div className="mt-10 space-y-10">{children}</div>
      <JsonLd data={jsonLdForPage(pageId)} />
    </article>
  );
}

export function QaSection({ id, heading, paragraphs, code }: CopyBlock & { id?: string }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="font-display text-3xl leading-tight">{heading}</h2>
      <div className="mt-3 space-y-3 text-[#ddd6c8]">
        {paragraphs.map((paragraph, index) => (
          <p key={`${heading}-${index}`}>{paragraph}</p>
        ))}
      </div>
      {code ? <pre className="code-block mt-4">{code}</pre> : null}
    </section>
  );
}

export function IssueGrid() {
  return (
    <ul className="mt-6 grid list-none gap-3 p-0 md:grid-cols-2">
      {ISSUE_CHECKS.map((item) => (
        <li key={item.title} className="lift rounded-2xl border border-white/10 bg-white/5 p-4">
          <h3 className="font-semibold">{item.title}</h3>
          <p className="mt-2 text-sm text-[#c9c2b2]">{item.answer}</p>
        </li>
      ))}
    </ul>
  );
}

export function PricingCards({ titles = "heading" }: { titles?: "heading" | "text" }) {
  const Title = titles === "heading" ? "h3" : "p";
  return (
    <div className="grid gap-4 md:grid-cols-4">
      <article className="lift rounded-3xl border border-white/10 bg-white/5 p-5">
        <Title className="font-semibold">{FREE_TIER.name}</Title>
        <p className="font-display text-4xl">{FREE_TIER.priceLabel}</p>
        <p className="mt-3 text-sm text-[#c5d2e6]">{FREE_TIER.blurb}</p>
      </article>
      {Object.values(TIERS).map((tier) => (
        <article key={tier.id} className="lift rounded-3xl border border-lime/40 bg-[#121c30] p-5">
          <Title className="font-semibold">{tier.name}</Title>
          <p className="font-display text-4xl">{tier.priceLabel}</p>
          <p className="text-xs">{TAX_NOTE}</p>
          <p className="mt-3 text-sm">{tier.blurb}</p>
        </article>
      ))}
    </div>
  );
}

export function TaxLine() {
  return <p className="text-sm text-[#b7b1a4]">{TAX_NOTE}</p>;
}

export function FaqList() {
  return (
    <>
      {FAQ.map((item) => (
        <section key={item.question}>
          <h2 className="font-display text-3xl leading-tight">{item.question}</h2>
          <p className="mt-3 text-[#ddd6c8]">{item.answer}</p>
        </section>
      ))}
    </>
  );
}

export function GuideArticle({ pageId }: { pageId: keyof typeof GUIDES }) {
  const guide = GUIDES[pageId];
  return (
    <PublicArticle pageId={pageId}>
      {guide.sections.map((section) => (
        <QaSection key={section.heading} {...section} />
      ))}
      <nav aria-label="Related pages">
        <h2 className="font-display text-3xl">Related pages</h2>
        <ul className="mt-3 space-y-2">
          {guide.related.map((id) => {
            const page = getPublicPage(id);
            return (
              <li key={id}>
                <Link className="text-lime" href={page.path}>
                  {page.h1}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <p>
        <Link href="/scans/new" className="btn btn-lime">
          Scan an app you own
        </Link>
      </p>
    </PublicArticle>
  );
}

export function ContactEmail() {
  const abuse = abuseContactEmail();
  return (
    <div className="space-y-3">
      <p>
        Product email:{" "}
        <a className="text-lime" href={`mailto:${CONTACT_EMAIL_PLACEHOLDER}`}>
          {CONTACT_EMAIL_PLACEHOLDER}
        </a>
      </p>
      <p>
        {abuse ? (
          <>
            Abuse reports:{" "}
            <a className="text-lime" href={`mailto:${abuse}`}>
              {abuse}
            </a>
          </>
        ) : (
          <>This server has not published an abuse email yet. Use the product email and put abuse report in the subject.</>
        )}
      </p>
    </div>
  );
}
