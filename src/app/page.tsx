import Link from "next/link";
import { FAMILIES, HEADLINE_THEMES } from "@/lib/catalog";
import { FREE_TIER, TIERS } from "@/lib/pricing";

export default function HomePage() {
  return (
    <div className="space-y-20 pb-16">
      <section className="grid items-end gap-10 pt-8 md:grid-cols-[1.3fr_0.7fr]">
        <div>
          <p className="text-sm uppercase tracking-[0.22em] text-lime">Launch scan for vibe-coded apps</p>
          <h1 className="mt-4 font-display text-6xl leading-[0.95] md:text-7xl">Ship the vibe. Check the doors.</h1>
          <p className="mt-6 max-w-xl text-lg text-[#ddd6c8]">
            VibeCheck reads the app you generated with Lovable, Bolt, Supabase, Firebase, or a similar stack and returns a security report: what is exposed, why it matters, and a fix you can paste.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/scans/new" className="btn btn-lime">
              Scan an app you own
            </Link>
            <Link href="/demo-report" className="btn btn-ghost">
              View a sample report
            </Link>
          </div>
        </div>
        <aside className="paper rotate-1 rounded-[28px] p-6 text-ink shadow-card">
          <p className="text-xs uppercase tracking-[0.16em] text-[#6d6758]">Before any probe</p>
          <ol className="mt-4 space-y-3 text-sm">
            <li>1. You prove the domain with DNS TXT or a well-known file.</li>
            <li>2. You check the consent box.</li>
            <li>3. The worker runs read-only checks and a few tiny unauthenticated POSTs.</li>
            <li>4. You get a score, a family-by-family report, and fixes.</li>
          </ol>
        </aside>
      </section>

      <section>
        <h2 className="font-display text-4xl">The ten issues we put first</h2>
        <p className="mt-2 max-w-2xl text-[#d9d3c5]">These are the headline findings. The full scan still covers every family below. The free teaser shows severity counts and two of the highest-priority issues.</p>
        <ol className="mt-6 grid gap-3 md:grid-cols-2">
          {HEADLINE_THEMES.map((theme) => (
            <li key={theme.rank} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <span className="font-display text-3xl text-lime">{theme.rank}</span>
              <h3 className="mt-1 font-semibold">{theme.title}</h3>
              <p className="text-sm text-[#c9c2b2]">{theme.summary}</p>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="font-display text-4xl">Eight families, one coverage summary</h2>
        <div className="mt-6 grid gap-3 md:grid-cols-4">
          {FAMILIES.map((family) => (
            <article key={family.id} className="rounded-2xl border border-white/10 p-4">
              <h3 className="font-semibold">{family.label}</h3>
              <p className="mt-2 text-sm text-[#c9c2b2]">{family.blurb}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="pricing">
        <h2 className="font-display text-4xl">Pricing</h2>
        <p className="mt-2 max-w-2xl text-[#d9d3c5]">Stripe Checkout uses price IDs from the environment. Amounts below are the products to create in test mode.</p>
        <div className="mt-6 grid gap-4 md:grid-cols-4">
          <article className="rounded-3xl border border-white/10 p-5">
            <h3 className="font-semibold">{FREE_TIER.name}</h3>
            <p className="font-display text-4xl">{FREE_TIER.priceLabel}</p>
            <p className="mt-3 text-sm text-[#c9c2b2]">{FREE_TIER.blurb}</p>
          </article>
          {Object.values(TIERS).map((tier) => (
            <article key={tier.id} className="rounded-3xl bg-lime p-5 text-ink">
              <h3 className="font-semibold">{tier.name}</h3>
              <p className="font-display text-4xl">{tier.priceLabel}</p>
              <p className="mt-3 text-sm">{tier.blurb}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-6 rounded-[28px] border border-white/10 p-6 md:grid-cols-[1.2fr_0.8fr]">
        <div>
          <h2 className="font-display text-4xl">Free mini check</h2>
          <p className="mt-3 text-[#d9d3c5]">
            Start with security headers and common public files on an origin you own. It is a funnel into the full launch scan, and the report says which families did not run.
          </p>
          <Link href="/check" className="btn btn-lime mt-5">
            Start a mini check
          </Link>
        </div>
        <div>
          <h3 className="font-display text-2xl text-lime">Score you can show</h3>
          <p className="mt-2 text-sm text-[#d9d3c5]">
            Opt in to a public page and an SVG badge. Visitors see the score and the scan date. After 30 days the badge reads “rescan needed”. Finding details never leave your account.
          </p>
        </div>
      </section>
    </div>
  );
}
