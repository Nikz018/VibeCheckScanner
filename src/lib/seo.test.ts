import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { FREE_TIER, TAX_NOTE, TIERS } from "./pricing";
import { scoreBand } from "./score-gauge";
import { containsToolBrand } from "./sanitize";
import manifest from "../app/manifest";
import robotsRoute from "../app/robots";
import sitemapRoute from "../app/sitemap";
import { GET as llmsFullRoute } from "../app/llms-full.txt/route";
import { GET as llmsRoute } from "../app/llms.txt/route";
import { publicCopyCorpus } from "./seo/corpus";
import {
  DEFINITION,
  DISCLAIMER,
  FAQ,
  HOME_DESCRIPTION,
  HOW_TO_STEPS,
  ISSUE_CHECKS,
  ISSUE_CHECKS_ANSWER,
  PUBLIC_PAGES,
  allCopyBlocks,
  getPublicPage,
  priceAnswer,
  scoreAnswer,
} from "./seo/content";
import { jsonLdForPage } from "./seo/jsonld";
import { llmsFullTxt, llmsTxt } from "./seo/llms";
import { pageMetadata, privateMetadata, rootMetadata, shareMetadata } from "./seo/metadata";
import { AI_CRAWLERS, ROBOTS_DISALLOW, SEARCH_CRAWLERS, isPathDisallowed, robotsPolicy } from "./seo/robots-policy";
import { absoluteUrl, getSiteUrl, normalizeSiteUrl } from "./seo/site";
import { sitemapEntries } from "./seo/sitemap-data";

const SITE = "https://scan.example";

test.before(() => {
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
});

function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.ok(value);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}

function typesOf(node: Record<string, unknown>): string[] {
  const value = node["@type"];
  if (typeof value === "string") return [value];
  assert.ok(Array.isArray(value), "missing @type");
  return value.map(String);
}

function graphNodes(data: Record<string, unknown>): Record<string, unknown>[] {
  assert.equal(data["@context"], "https://schema.org");
  assert.ok(Array.isArray(data["@graph"]));
  return (data["@graph"] as unknown[]).map((node) => asRecord(node));
}

function findType(nodes: Record<string, unknown>[], type: string): Record<string, unknown> {
  const found = nodes.find((node) => typesOf(node).includes(type));
  assert.ok(found, `missing ${type}`);
  return found;
}

function walk(value: unknown, visit: (value: unknown) => void) {
  visit(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) walk(item, visit);
  }
}

test("site url uses NEXT_PUBLIC_SITE_URL for absolute links", () => {
  assert.equal(getSiteUrl(), SITE);
  assert.equal(absoluteUrl("/pricing"), `${SITE}/pricing`);
  assert.equal(absoluteUrl("/"), SITE);
  assert.equal(normalizeSiteUrl("scan.example"), "https://scan.example");
  assert.equal(normalizeSiteUrl(`${SITE}/`), SITE);
  assert.equal(normalizeSiteUrl("not a url !!!"), "http://localhost:3000");
  assert.equal(normalizeSiteUrl(undefined), "http://localhost:3000");
});

test("public metadata has canonical, Open Graph, and Twitter cards", () => {
  const root = rootMetadata();
  assert.equal(root.metadataBase?.toString(), `${SITE}/`);
  assert.equal(root.title && typeof root.title === "object" && "template" in root.title ? root.title.template : "", "%s · VibeCheck");
  assert.equal(root.description, HOME_DESCRIPTION);
  for (const page of PUBLIC_PAGES) {
    const meta = pageMetadata(page.id);
    const title = meta.title;
    assert.ok(title);
    assert.ok(page.description.length >= 50 && page.description.length <= 180, `${page.id} description length ${page.description.length}`);
    const canonical = meta.alternates && typeof meta.alternates === "object" ? meta.alternates.canonical : "";
    assert.equal(canonical, absoluteUrl(page.path));
    const og = asRecord(meta.openGraph);
    assert.equal(og.title, page.absoluteTitle ?? `${page.title} · VibeCheck`);
    assert.equal(og.description, page.description);
    assert.equal(og.url, absoluteUrl(page.path));
    const images = og.images as Array<{ url: string; width: number; height: number; alt: string }>;
    assert.equal(images[0].url, `${SITE}/opengraph-image`);
    assert.equal(images[0].width, 1200);
    assert.equal(images[0].height, 630);
    assert.ok(images[0].alt.includes("Example") || images[0].alt.includes("example"));
    const twitter = asRecord(meta.twitter);
    assert.equal(twitter.card, "summary_large_image");
    assert.ok(Array.isArray(twitter.images));
    const robots = asRecord(meta.robots);
    assert.equal(robots.index, true);
    assert.equal(robots.follow, true);
  }
});

test("private screens are noindex and public share scores stay indexable", () => {
  const hidden = privateMetadata("Dashboard");
  const robots = asRecord(hidden.robots);
  assert.equal(robots.index, false);
  assert.equal(robots.follow, false);
  const share = shareMetadata("abc123");
  assert.equal(asRecord(share.robots).index, true);
  assert.equal(share.alternates && typeof share.alternates === "object" ? share.alternates.canonical : "", `${SITE}/share/abc123`);
});

test("robots allows search and AI crawlers and blocks private areas", () => {
  const policy = robotsRoute();
  assert.deepEqual(policy, robotsPolicy());
  assert.equal(policy.sitemap, `${SITE}/sitemap.xml`);
  assert.equal(policy.host, SITE);
  const rules = Array.isArray(policy.rules) ? policy.rules : [policy.rules];
  const agents = rules.map((rule) => rule.userAgent);
  for (const agent of ["*", ...SEARCH_CRAWLERS, ...AI_CRAWLERS]) {
    assert.ok(agents.includes(agent), `missing user-agent ${agent}`);
  }
  for (const rule of rules) {
    assert.equal(rule.allow, "/");
    for (const prefix of ROBOTS_DISALLOW) {
      assert.ok(Array.isArray(rule.disallow) && rule.disallow.includes(prefix), String(rule.userAgent));
    }
    assert.equal(Array.isArray(rule.disallow) && rule.disallow.some((path) => path.startsWith("/share")), false);
  }
  for (const path of ["/", "/pricing", "/faq", "/how-it-works", "/guides", "/guides/supabase-rls-checklist", "/llms.txt", "/share/public-token", "/demo-report"]) {
    assert.equal(isPathDisallowed(path), false, path);
  }
  for (const path of ["/dashboard", "/api/health", "/scans/abc", "/scans/new", "/login", "/check", "/check?url=https://example.com"]) {
    assert.equal(isPathDisallowed(path), true, path);
  }
});

test("sitemap lists public pages and leaves out private routes", () => {
  const entries = sitemapRoute();
  const withoutDates = (rows: typeof entries) => rows.map(({ lastModified: _lastModified, ...entry }) => entry);
  assert.deepEqual(withoutDates(entries), withoutDates(sitemapEntries()));
  const urls = entries.map((entry) => entry.url);
  for (const page of PUBLIC_PAGES) {
    assert.ok(urls.includes(absoluteUrl(page.path)), page.path);
  }
  assert.ok(urls.includes(`${SITE}/llms.txt`));
  assert.ok(urls.includes(`${SITE}/llms-full.txt`));
  for (const entry of entries) {
    assert.ok(entry.url.startsWith(`${SITE}/`) || entry.url === SITE);
    assert.ok(entry.lastModified instanceof Date);
    assert.ok((entry.priority ?? 0) > 0 && (entry.priority ?? 0) <= 1);
    assert.equal(isPathDisallowed(entry.url), false, entry.url);
  }
  const joined = urls.join("\n");
  for (const blocked of ["/dashboard", "/api", "/scans", "/login", "/check", "/share/"]) {
    assert.equal(joined.includes(`${SITE}${blocked}`), false, blocked);
  }
});

test("JSON-LD is valid schema.org for each public page", () => {
  for (const page of PUBLIC_PAGES) {
    const data = jsonLdForPage(page.id);
    const cloned = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
    const nodes = graphNodes(cloned);
    assert.ok(nodes.length >= 3, page.id);
    for (const node of nodes) {
      assert.ok(typesOf(node).length > 0);
      assert.equal(node["@context"], undefined);
    }
    const organization = findType(nodes, "Organization");
    assert.equal(organization.name, "VibeCheck");
    assert.equal(organization.url, SITE);
    const website = findType(nodes, "WebSite");
    assert.equal(website.url, SITE);
    const webPage = findType(nodes, "WebPage");
    assert.equal(webPage.url, absoluteUrl(page.path));
    assert.equal(webPage.name, page.h1);
    if (page.id !== "home") {
      const crumbs = findType(nodes, "BreadcrumbList");
      const list = crumbs.itemListElement as Array<{ "@type": string; position: number; item: string }>;
      assert.deepEqual(
        list.map((item) => item.position),
        list.map((_, index) => index + 1),
      );
      assert.equal(list[0]["@type"], "ListItem");
      assert.equal(list.at(-1)?.item, absoluteUrl(page.path));
    }
    walk(cloned, (value) => {
      if (typeof value === "string" && /^https?:\/\//.test(value)) {
        const allowed = value.startsWith(SITE) || value === "https://schema.org" || value.startsWith("https://schema.org/");
        assert.equal(allowed, true, `${page.id} unexpected url ${value}`);
      }
    });
  }

  const home = graphNodes(jsonLdForPage("home"));
  const software = findType(home, "SoftwareApplication");
  assert.ok(typesOf(software).includes("Product"));
  assert.equal(software.description, DEFINITION);
  const offers = software.offers as Array<Record<string, unknown>>;
  assert.equal(offers.length, 4);
  assert.deepEqual(
    offers.map((offer) => offer.price).sort(),
    [FREE_TIER.amountUsd, TIERS.monitor.amountUsd, TIERS.report.amountUsd, TIERS.rescan.amountUsd].map((amount) => amount.toFixed(2)).sort(),
  );
  for (const offer of offers) {
    assert.equal(offer["@type"], "Offer");
    assert.equal(offer.priceCurrency, "USD");
    assert.equal(typeof offer.name, "string");
    assert.ok(String(offer.description).length > 10);
    if (offer.price !== "0.00") {
      assert.equal(offer.valueAddedTaxIncluded, false);
      assert.match(String(offer.description), /applicable taxes/);
    }
  }
  const monitor = offers.find((offer) => String(offer["@id"]).endsWith("offer-monitor"));
  assert.equal(asRecord(monitor?.priceSpecification).unitText, "MONTH");
  assert.deepEqual(software.featureList, ISSUE_CHECKS.map((item) => item.title));

  const pricing = graphNodes(jsonLdForPage("pricing"));
  assert.equal((findType(pricing, "SoftwareApplication").offers as unknown[]).length, 4);

  const faq = findType(graphNodes(jsonLdForPage("faq")), "FAQPage");
  const questions = faq.mainEntity as Array<Record<string, unknown>>;
  assert.ok(questions.length >= 8 && questions.length <= 13);
  assert.equal(questions.length, FAQ.length);
  for (const [index, question] of questions.entries()) {
    assert.equal(question["@type"], "Question");
    assert.equal(question.name, FAQ[index].question);
    assert.equal(asRecord(question.acceptedAnswer)["@type"], "Answer");
    assert.equal(asRecord(question.acceptedAnswer).text, FAQ[index].answer);
  }

  const howTo = findType(graphNodes(jsonLdForPage("how-it-works")), "HowTo");
  const steps = howTo.step as Array<Record<string, unknown>>;
  assert.equal(steps.length, HOW_TO_STEPS.length);
  for (const [index, step] of steps.entries()) {
    assert.equal(step["@type"], "HowToStep");
    assert.equal(step.position, index + 1);
    assert.equal(step.name, HOW_TO_STEPS[index].heading);
    assert.equal(step.text, HOW_TO_STEPS[index].paragraphs[0]);
    assert.equal(step.url, `${SITE}/how-it-works#step-${index + 1}`);
  }

  const article = findType(graphNodes(jsonLdForPage("guide-rls")), "Article");
  assert.match(String(article.articleBody), /row level security/i);
  assert.match(String(article.headline), /\?$/);
});

test("answer-shaped copy and llms files describe the product without tool brands", () => {
  assert.ok(FAQ.length >= 8 && FAQ.length <= 13);
  for (const item of FAQ) {
    assert.match(item.question, /\?$/);
    assert.ok(item.answer.length > 40, item.question);
  }
  for (const block of allCopyBlocks()) {
    assert.match(block.heading, /\?$/);
    assert.ok(block.paragraphs[0] && block.paragraphs[0].length > 40, block.heading);
  }
  assert.match(DEFINITION, /^VibeCheck is a security scanner/);
  assert.match(ISSUE_CHECKS_ANSWER, /leaked API keys/);
  assert.match(ISSUE_CHECKS_ANSWER, /Supabase/);
  assert.match(ISSUE_CHECKS_ANSWER, /Firebase/);
  assert.match(ISSUE_CHECKS_ANSWER, /user IDs/);
  assert.match(ISSUE_CHECKS_ANSWER, /paywall/);
  assert.match(ISSUE_CHECKS_ANSWER, /security headers/);
  assert.match(priceAnswer(), /\$49/);
  assert.match(priceAnswer(), /\$99/);
  assert.match(priceAnswer(), /\$29 per month/);
  assert.match(priceAnswer(), /applicable taxes/);
  assert.match(scoreAnswer(), new RegExp(scoreBand(0).label));
  assert.match(scoreAnswer(), new RegExp(scoreBand(40).label));
  assert.match(scoreAnswer(), new RegExp(scoreBand(70).label));
  assert.match(scoreAnswer(), new RegExp(scoreBand(100).label));
  assert.equal(scoreBand(39).label, "Critical risk");
  assert.equal(scoreBand(69).label, "Needs work");
  assert.equal(scoreBand(89).label, "Good");

  const llms = llmsTxt();
  const full = llmsFullTxt();
  assert.match(llms, new RegExp(DEFINITION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(llms, /\$49/);
  assert.match(llms, /\$99/);
  assert.match(llms, /\$29 per month/);
  for (const page of PUBLIC_PAGES) {
    assert.match(llms, new RegExp(absoluteUrl(page.path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(full, /## FAQ/);
  assert.match(full, /## How a scan works/);
  assert.match(full, /## Guides/);
  assert.match(llms, /llms-full\.txt/);

  const corpus = publicCopyCorpus();
  assert.equal(containsToolBrand(corpus), null);
  assert.doesNotMatch(corpus, /\b(SOC\s*2|HIPAA|PCI(?:\s|-)?DSS|ISO\s*27001)\b/i);
  assert.doesNotMatch(corpus, /testimonial|trusted by|customers trust/i);
  assert.match(corpus, new RegExp(DISCLAIMER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(corpus, new RegExp(TAX_NOTE));
  assert.doesNotMatch(corpus, /Nikz/);
  assert.doesNotMatch(corpus, /contact@example\.com/);
  assert.doesNotMatch(corpus, /\bdraft\b/i);
});

test("llms routes return text, and the manifest names the app", async () => {
  const brief = llmsRoute();
  assert.equal(brief.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.match(await brief.text(), /What VibeCheck checks/);
  const long = llmsFullRoute();
  assert.match(await long.text(), /## FAQ/);
  const webManifest = manifest();
  assert.equal(webManifest.name, "VibeCheck");
  assert.equal(webManifest.lang, "en");
  assert.equal(webManifest.start_url, "/");
  assert.ok(webManifest.icons && webManifest.icons.length >= 2);
});

test("pages, layout, and image routes are wired to the SEO helpers", () => {
  const root = process.cwd();
  const read = (file: string) => readFileSync(path.join(root, file), "utf8");
  const layout = read("src/app/layout.tsx");
  assert.match(layout, /lang="en"/);
  assert.match(layout, /rootMetadata\(\)/);
  assert.match(layout, /DISCLAIMER/);
  assert.match(layout, /display:\s*"swap"/);
  assert.match(read("src/app/page.tsx"), /pageMetadata\(\s*"home"\s*\)/);
  assert.match(read("src/app/page.tsx"), /DEFINITION/);
  assert.match(read("src/app/page.tsx"), /id="pricing"/);
  assert.match(read("src/app/page.tsx"), /What does VibeCheck check\?/);
  const expected: Record<string, string> = {
    "src/app/pricing/page.tsx": "pricing",
    "src/app/faq/page.tsx": "faq",
    "src/app/how-it-works/page.tsx": "how-it-works",
    "src/app/guides/page.tsx": "guides",
    "src/app/guides/is-my-lovable-app-secure/page.tsx": "guide-lovable",
    "src/app/guides/supabase-rls-checklist/page.tsx": "guide-rls",
    "src/app/guides/leaked-api-keys-vibe-coding/page.tsx": "guide-keys",
    "src/app/demo-report/page.tsx": "demo-report",
    "src/app/terms/page.tsx": "terms",
    "src/app/privacy/page.tsx": "privacy",
    "src/app/refund/page.tsx": "refund",
    "src/app/contact/page.tsx": "contact",
    "src/app/scanner-info/page.tsx": "scanner-info",
  };
  for (const [file, id] of Object.entries(expected)) {
    assert.match(read(file), new RegExp(`pageMetadata\\(\\s*"${id}"\\s*\\)`), file);
    assert.match(read(file), /<h1|PublicArticle|GuideArticle/, file);
  }
  for (const file of ["src/app/dashboard/page.tsx", "src/app/login/page.tsx", "src/app/check/page.tsx", "src/app/scans/new/page.tsx", "src/app/scans/[id]/page.tsx"]) {
    assert.match(read(file), /privateMetadata\(/, file);
  }
  assert.match(read("src/app/share/[token]/page.tsx"), /shareMetadata\(/);
  assert.match(read("src/app/opengraph-image.tsx"), /from "next\/og"/);
  assert.match(read("src/app/opengraph-image.tsx"), /OG_WIDTH/);
  assert.equal(read("src/lib/seo/content.ts").includes("export const OG_WIDTH = 1200"), true);
  assert.match(read("src/app/icon.tsx"), /from "next\/og"/);
  assert.match(read("src/app/apple-icon.tsx"), /from "next\/og"/);
  assert.match(read(".env.example"), /NEXT_PUBLIC_SITE_URL=/);
  assert.equal(getPublicPage("guide-rls").path, "/guides/supabase-rls-checklist");
  assert.equal(getPublicPage("guide-lovable").path, "/guides/is-my-lovable-app-secure");
  assert.equal(getPublicPage("guide-keys").path, "/guides/leaked-api-keys-vibe-coding");
});
