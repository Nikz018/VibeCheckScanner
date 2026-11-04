import type { Metadata } from "next";
import Link from "next/link";
import { HeroVisual } from "@/components/HeroVisual";
import { IssueGrid, JsonLd, PricingCards, TaxLine } from "@/components/Marketing";
import { Reveal } from "@/components/Reveal";
import { FAMILIES, HEADLINE_THEMES } from "@/lib/catalog";
import { DEFINITION, DISCLAIMER, ISSUE_CHECKS_ANSWER, getPublicPage, priceAnswer } from "@/lib/seo/content";
import { jsonLdForPage } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata("home");

const START_HERE = ["how-it-works", "faq", "guides", "guide-lovable", "guide-rls", "guide-keys"] as const;

export default function HomePage() {
  return (
    <div className="space-y-20 pb-16">
      <JsonLd data={jsonLdForPage("home")} />
      <section className="grid items-center gap-10 pt-4 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <p className="text-sm uppercase tracking-[0.22em] text-lime">Launch scan for vibe-coded apps</p>
          <h1 className="mt-4 font-display text-5xl leading-[0.95] sm:text-6xl md:text-7xl">Ship the vibe. Check the doors.</h1>
          <span aria-hidden="true" className="mt-6 block h-[3px] w-14 rounded-full bg-lime" />
          <p className="mt-6 max-w-xl text-lg text-[#f3eee9]">{DEFINITION}</p>
          <p className="mt-3 max-w-xl text-[#cfc4bb]">{DISCLAIMER}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/scans/new" className="btn btn-lime">
              Scan an app you own
            </Link>
            <Link href="/demo-report#free-preview" className="btn btn-ghost">
              View a free preview
            </Link>
          </div>
        </div>
        <HeroVisual />
      </section>

      <Reveal>
        <section aria-labelledby="what-we-check">
          <h2 id="what-we-check" className="font-display text-4xl">
            What does VibeCheck check?
          </h2>
          <p className="mt-3 max-w-3xl text-[#cfc4bb]">{ISSUE_CHECKS_ANSWER}</p>
          <IssueGrid />
        </section>
      </Reveal>

      <Reveal>
        <section>
          <h2 className="font-display text-4xl">The ten issues we put first</h2>
          <p className="mt-2 max-w-2xl text-[#cfc4bb]">
            These are the headline findings. The full scan still covers every family below. A free preview shows the true severity counts and the lowest-severity finding. The rest stay off the page.
          </p>
          <ol className="mt-6 grid gap-3 md:grid-cols-2">
            {HEADLINE_THEMES.map((theme) => (
              <li key={theme.rank} className="lift rounded-2xl border border-white/10 bg-white/5 p-4">
                <span className="font-display text-3xl text-lime">{theme.rank}</span>
                <h3 className="mt-1 font-semibold">{theme.title}</h3>
                <p className="text-sm text-[#cfc4bb]">{theme.summary}</p>
              </li>
            ))}
          </ol>
        </section>
      </Reveal>

      <Reveal>
        <section>
          <h2 className="font-display text-4xl">Eight families, one coverage summary</h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 md:grid-cols-4">
            {FAMILIES.map((family) => (
              <article key={family.id} className="lift rounded-2xl border border-white/10 p-4">
                <h3 className="font-semibold">{family.label}</h3>
                <p className="mt-2 text-sm text-[#cfc4bb]">{family.blurb}</p>
              </article>
            ))}
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section id="pricing">
          <h2 className="font-display text-4xl">How much does VibeCheck cost?</h2>
          <p className="mt-3 max-w-3xl text-[#cfc4bb]">{priceAnswer()}</p>
          <div className="mt-6">
            <PricingCards />
          </div>
          <TaxLine />
          <Link href="/pricing" className="mt-4 inline-block text-lime">
            Pricing details
          </Link>
        </section>
      </Reveal>

      <Reveal>
        <section className="panel panel-glow grid gap-6 p-6 md:grid-cols-[1.2fr_0.8fr]">
          <div>
            <h2 className="font-display text-4xl">Free mini check</h2>
            <p className="mt-3 text-[#cfc4bb]">
              Start with security headers and common public files on an origin you own. It is a funnel into the full launch scan, and the report says which families did not run.
            </p>
            <Link href="/check" className="btn btn-lime mt-5">
              Start a mini check
            </Link>
          </div>
          <div>
            <h3 className="font-display text-2xl text-lime">Score you can show</h3>
            <p className="mt-2 text-sm text-[#cfc4bb]">
              Opt in to a public page and an SVG badge. Visitors see the score and the scan date. After 30 days the badge reads “rescan needed”. Finding details never leave your account.
            </p>
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section>
          <h2 className="font-display text-4xl">Where should I start?</h2>
          <ul className="mt-4 space-y-2 text-[#f3eee9]">
            {START_HERE.map((id) => {
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
        </section>
      </Reveal>
    </div>
  );
}
