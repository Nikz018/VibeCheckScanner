import type { Metadata } from "next";
import Link from "next/link";
import { CopyButton } from "@/components/CopyButton";
import { PublicArticle } from "@/components/Marketing";
import { LOVABLE_BOLT_PROMPT, OWNERSHIP_GUIDE_STEPS, type GuideChunk } from "@/lib/ownership-guide";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata("verify-ownership");

export default function VerifyOwnershipPage() {
  return (
    <PublicArticle pageId="verify-ownership">
      <div className="grid gap-3 sm:grid-cols-2">
        <a href="#dns" className="rounded-2xl border border-white/10 bg-white/5 p-4 hover:border-lime/40">
          <p className="font-semibold">Option A · DNS TXT</p>
          <p className="mt-2 text-sm text-[#ddd6c8]">Add a text note on the domain. Use this when you can sign in where the domain is managed.</p>
        </a>
        <a href="#file" className="rounded-2xl border border-white/10 bg-white/5 p-4 hover:border-lime/40">
          <p className="font-semibold">Option B · Text file</p>
          <p className="mt-2 text-sm text-[#ddd6c8]">Add one file and open its link. A good fit for Lovable, Bolt, Vercel, Netlify, and similar hosts.</p>
        </a>
      </div>
      <nav aria-label="On this page" className="rounded-2xl border border-white/10 p-4">
        <p className="text-xs uppercase tracking-[0.16em] text-[#d9d3c5]">On this page</p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-[#ddd6c8]">
          {OWNERSHIP_GUIDE_STEPS.map((step) => (
            <li key={step.id}>
              <a className="text-lime" href={`#${step.id}`}>
                {step.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className="space-y-12">
        {OWNERSHIP_GUIDE_STEPS.map((step, index) => (
          <section key={step.id} id={step.id} className="scroll-mt-24">
            <h2 className="flex items-start gap-3 font-display text-3xl leading-tight">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-lime text-base font-semibold text-ink">{index + 1}</span>
              <span>{step.title}</span>
            </h2>
            <div className="mt-3 space-y-3 text-[#ddd6c8]">
              {step.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
            {step.chunks ? (
              <div className="mt-6 space-y-6">
                {step.chunks.map((chunk) => (
                  <ChunkView key={chunk.id} chunk={chunk} />
                ))}
              </div>
            ) : null}
          </section>
        ))}
      </div>
      <p>
        <Link href="/scans/new" className="btn btn-lime">
          Scan an app you own
        </Link>
      </p>
    </PublicArticle>
  );
}

function ChunkView({ chunk }: { chunk: GuideChunk }) {
  const body = (
    <>
      <h3 className="font-display text-2xl leading-tight">{chunk.title}</h3>
      {chunk.paragraphs?.map((paragraph) => (
        <p key={paragraph} className="mt-3 text-[#ddd6c8]">
          {paragraph}
        </p>
      ))}
      {chunk.steps ? (
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-[#ddd6c8]">
          {chunk.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
      {chunk.notes?.map((note) => (
        <p key={note} className="mt-3 text-[#ddd6c8]">
          {note}
        </p>
      ))}
      {chunk.prompt ? (
        <div className="mt-4">
          <CopyButton value={LOVABLE_BOLT_PROMPT} label="prompt" text="Copy prompt" tone="dark" />
          <pre className="code-block mt-3">{LOVABLE_BOLT_PROMPT}</pre>
        </div>
      ) : null}
      {chunk.code ? <pre className="code-block mt-4">{chunk.code}</pre> : null}
      {chunk.links?.map((link) => (
        <p key={link.href} className="mt-3">
          <a className="text-lime underline" href={link.href} target="_blank" rel="noopener noreferrer">
            {link.label}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      ))}
    </>
  );
  if (!chunk.panel) {
    return (
      <div id={chunk.id} className="scroll-mt-24">
        {body}
      </div>
    );
  }
  return (
    <section id={chunk.id} className="scroll-mt-24 rounded-2xl border border-white/10 bg-white/5 p-4 md:p-5">
      {body}
    </section>
  );
}
