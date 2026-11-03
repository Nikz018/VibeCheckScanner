import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { containsToolBrand } from "./sanitize";
import {
  LOVABLE_BOLT_PROMPT,
  OWNERSHIP_GUIDE_LINK_LABEL,
  OWNERSHIP_GUIDE_PATH,
  OWNERSHIP_GUIDE_STEPS,
  OWNERSHIP_NOT_FOUND_HINT,
  isOwnershipNotFound,
  ownershipGuidePlainText,
} from "./ownership-guide";
import { FAQ, getPublicPage } from "./seo/content";
import { sitemapEntries } from "./seo/sitemap-data";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

test("ownership guide explains both proofs for a non-technical reader", () => {
  const text = ownershipGuidePlainText();
  const required = [
    "token",
    "DNS TXT",
    "Cloudflare",
    "GoDaddy",
    "Namecheap",
    "Hostinger",
    "Google Domains",
    "Squarespace",
    "Route 53",
    "@",
    "apex",
    "propagation",
    "few minutes",
    "few hours",
    "public DNS lookup",
    "dns.google",
    "nslookup",
    "public/.well-known/vibecheck-verify.txt",
    "Next.js",
    "Vite",
    "Vercel",
    "Netlify",
    "Lovable",
    "Bolt",
    "PASTE_THE_TOKEN_HERE",
    "www.example.com",
    "https",
    "404",
    "quotes",
    "subdomain",
    "Ownership proof was not found",
  ];
  for (const phrase of required) {
    assert.ok(text.includes(phrase), phrase);
  }
  assert.match(LOVABLE_BOLT_PROMPT, /public\/\.well-known\/vibecheck-verify\.txt/);
  assert.match(OWNERSHIP_NOT_FOUND_HINT, /DNS can take time/);
  assert.match(OWNERSHIP_NOT_FOUND_HINT, /only the token/);
  for (const id of ["cloudflare", "godaddy", "namecheap", "hostinger", "squarespace", "route-53"]) {
    const chunk = OWNERSHIP_GUIDE_STEPS.flatMap((step) => step.chunks ?? []).find((item) => item.id === id);
    assert.ok(chunk, id);
    assert.ok((chunk.steps?.length ?? 0) >= 4, id);
  }
  assert.equal(containsToolBrand(text), null);
  assert.doesNotMatch(text, /\b\d{1,3}%/);
  assert.doesNotMatch(text, /trusted by|most users|9 out of 10|studies show/i);
  assert.equal(isOwnershipNotFound("Ownership proof was not found. Publish the token in DNS TXT or at /.well-known/vibecheck-verify.txt and try again."), true);
  assert.equal(isOwnershipNotFound("Consent is required before a scan can start"), false);
});

test("proof UI links to the guide, copies each field, and hints when the proof is missing", () => {
  const fields = read("src/components/OwnershipProofFields.tsx");
  const form = read("src/components/NewScanForm.tsx");
  const followup = read("src/components/PaidScanFollowup.tsx");
  assert.match(fields, /target="_blank"/);
  assert.match(fields, /rel="noopener noreferrer"/);
  assert.match(fields, /OWNERSHIP_GUIDE_LINK_LABEL/);
  assert.match(fields, /OWNERSHIP_NOT_FOUND_HINT/);
  assert.match(fields, /Copy \$\{label\}/);
  for (const label of ["Host", "Value", "URL", "Body"]) {
    assert.match(fields, new RegExp(`label="${label}"`));
  }
  assert.match(form, /OwnershipProofFields/);
  assert.match(form, /OwnershipNotFoundHint/);
  assert.match(form, /Prove you own/);
  assert.match(followup, /OwnershipProofFields/);
  assert.match(followup, /OwnershipNotFoundHint/);
  assert.match(read("src/lib/ownership.ts"), /Ownership proof was not found/);
});

test("sitemap, FAQ, and the public page include the ownership guide", () => {
  assert.equal(getPublicPage("verify-ownership").path, OWNERSHIP_GUIDE_PATH);
  assert.equal(OWNERSHIP_GUIDE_LINK_LABEL, "How do I do this? Step-by-step guide");
  assert.ok(sitemapEntries().some((entry) => entry.url.endsWith(OWNERSHIP_GUIDE_PATH)));
  const item = FAQ.find((entry) => entry.question === "Do I have to prove I own the app?");
  assert.ok(item);
  assert.equal(item.link?.href, OWNERSHIP_GUIDE_PATH);
  assert.equal(item.link?.label, OWNERSHIP_GUIDE_LINK_LABEL);
  assert.match(item.answer, /\/docs\/verify-ownership/);
  const page = read("src/app/docs/verify-ownership/page.tsx");
  const faq = read("src/app/faq/page.tsx");
  assert.match(page, /pageMetadata\(\s*"verify-ownership"\s*\)/);
  assert.match(page, /PublicArticle/);
  assert.match(page, /Copy prompt/);
  assert.match(faq, /\/docs\/verify-ownership/);
  assert.equal(containsToolBrand(`${page}\n${faq}\n${read("src/components/OwnershipProofFields.tsx")}`), null);
});
