import { FREE_TIER, TAX_NOTE, TIERS } from "../pricing";
import {
  DEFINITION,
  FAQ,
  GUIDES,
  HOME_DESCRIPTION,
  HOW_TO_STEPS,
  ISSUE_CHECKS,
  SITE_NAME,
  breadcrumbsFor,
  getPublicPage,
  type PublicPageId,
} from "./content";
import { absoluteUrl, getSiteUrl } from "./site";

export function organizationId(): string {
  return `${getSiteUrl()}/#organization`;
}

export function websiteId(): string {
  return `${getSiteUrl()}/#website`;
}

export function softwareId(): string {
  return `${getSiteUrl()}/#software`;
}

function graph(nodes: Record<string, unknown>[]): Record<string, unknown> {
  return { "@context": "https://schema.org", "@graph": nodes };
}

function organizationNode(includeDescription: boolean): Record<string, unknown> {
  const node: Record<string, unknown> = {
    "@type": "Organization",
    "@id": organizationId(),
    name: SITE_NAME,
    url: getSiteUrl(),
    logo: {
      "@type": "ImageObject",
      url: absoluteUrl("/apple-icon"),
    },
  };
  if (includeDescription) node.description = DEFINITION;
  return node;
}

function websiteNode(includeDescription: boolean): Record<string, unknown> {
  const node: Record<string, unknown> = {
    "@type": "WebSite",
    "@id": websiteId(),
    url: getSiteUrl(),
    name: SITE_NAME,
    inLanguage: "en",
    publisher: { "@id": organizationId() },
  };
  if (includeDescription) node.description = HOME_DESCRIPTION;
  return node;
}

function offerNodes(): Record<string, unknown>[] {
  const plans: Array<{ id: string; name: string; amountUsd: number; description: string; monthly?: boolean }> = [
    { id: "teaser", name: FREE_TIER.name, amountUsd: FREE_TIER.amountUsd, description: FREE_TIER.blurb },
    ...Object.values(TIERS).map((tier) => ({
      id: tier.id,
      name: tier.name,
      amountUsd: tier.amountUsd,
      description: `${tier.blurb} ${TAX_NOTE}`,
      monthly: tier.cadence === "monthly",
    })),
  ];
  return plans.map((plan) => {
    const price = plan.amountUsd.toFixed(2);
    const offer: Record<string, unknown> = {
      "@type": "Offer",
      "@id": `${getSiteUrl()}/#offer-${plan.id}`,
      name: plan.name,
      price,
      priceCurrency: "USD",
      url: absoluteUrl("/pricing"),
      availability: "https://schema.org/InStock",
      description: plan.description,
    };
    if (plan.amountUsd > 0) offer.valueAddedTaxIncluded = false;
    if (plan.monthly) {
      offer.priceSpecification = {
        "@type": "UnitPriceSpecification",
        price,
        priceCurrency: "USD",
        unitText: "MONTH",
        referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" },
      };
    }
    return offer;
  });
}

function softwareNode(options: { offers: boolean; features: boolean }): Record<string, unknown> {
  const node: Record<string, unknown> = {
    "@type": ["SoftwareApplication", "Product"],
    "@id": softwareId(),
    name: SITE_NAME,
    applicationCategory: "SecurityApplication",
    applicationSubCategory: "Security scanner",
    operatingSystem: "Web",
    url: absoluteUrl("/"),
    description: options.features ? DEFINITION : getPublicPage("pricing").lede,
    image: absoluteUrl("/opengraph-image"),
    brand: { "@type": "Brand", name: SITE_NAME },
    publisher: { "@id": organizationId() },
    isAccessibleForFree: true,
  };
  if (options.features) node.featureList = ISSUE_CHECKS.map((item) => item.title);
  if (options.offers) node.offers = offerNodes();
  return node;
}

function webPageNode(id: PublicPageId): Record<string, unknown> {
  const page = getPublicPage(id);
  const url = absoluteUrl(page.path);
  const node: Record<string, unknown> = {
    "@type": "WebPage",
    "@id": `${url}#webpage`,
    url,
    name: page.h1,
    description: page.description,
    inLanguage: "en",
    isPartOf: { "@id": websiteId() },
    about: { "@id": softwareId() },
  };
  if (id !== "home") node.breadcrumb = { "@id": `${url}#breadcrumb` };
  return node;
}

function breadcrumbNode(id: PublicPageId): Record<string, unknown> {
  const page = getPublicPage(id);
  const url = absoluteUrl(page.path);
  const crumbs = breadcrumbsFor(id);
  return {
    "@type": "BreadcrumbList",
    "@id": `${url}#breadcrumb`,
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}

function faqNode(): Record<string, unknown> {
  return {
    "@type": "FAQPage",
    "@id": `${absoluteUrl("/faq")}#faq`,
    url: absoluteUrl("/faq"),
    inLanguage: "en",
    mainEntity: FAQ.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

function howToNode(): Record<string, unknown> {
  const page = absoluteUrl("/how-it-works");
  return {
    "@type": "HowTo",
    "@id": `${page}#howto`,
    name: "How a VibeCheck scan works",
    description: getPublicPage("how-it-works").lede,
    inLanguage: "en",
    step: HOW_TO_STEPS.map((step, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      name: step.heading,
      text: step.paragraphs[0],
      url: `${page}#step-${index + 1}`,
    })),
  };
}

function articleNode(id: "guide-lovable" | "guide-rls" | "guide-keys"): Record<string, unknown> {
  const page = getPublicPage(id);
  const url = absoluteUrl(page.path);
  const guide = GUIDES[id];
  const articleBody = [page.lede, ...guide.sections.map((section) => [section.heading, ...section.paragraphs, section.code ?? ""].filter(Boolean).join("\n"))].join("\n\n");
  return {
    "@type": "Article",
    "@id": `${url}#article`,
    headline: page.h1,
    description: page.description,
    inLanguage: "en",
    mainEntityOfPage: url,
    author: { "@id": organizationId() },
    publisher: { "@id": organizationId() },
    articleBody,
  };
}

export function jsonLdForPage(id: PublicPageId): Record<string, unknown> {
  const nodes: Record<string, unknown>[] = [
    organizationNode(id === "home" || id === "faq"),
    websiteNode(id === "home"),
    webPageNode(id),
  ];
  if (id !== "home") nodes.push(breadcrumbNode(id));
  if (id === "home") nodes.push(softwareNode({ offers: true, features: true }));
  if (id === "pricing") nodes.push(softwareNode({ offers: true, features: false }));
  if (id === "faq") nodes.push(faqNode());
  if (id === "how-it-works") nodes.push(howToNode());
  if (id === "guide-lovable" || id === "guide-rls" || id === "guide-keys") nodes.push(articleNode(id));
  return graph(nodes);
}
