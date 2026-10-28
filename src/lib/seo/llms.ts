import { FREE_TIER, TAX_NOTE, TIERS } from "../pricing";
import {
  DEFINITION,
  DISCLAIMER,
  FAQ,
  GUIDES,
  HOW_TO_EXTRAS,
  HOW_TO_STEPS,
  ISSUE_CHECKS,
  ISSUE_CHECKS_ANSWER,
  SITE_NAME,
  getPublicPage,
  monitoringPriceWords,
  priceAnswer,
} from "./content";
import { absoluteUrl } from "./site";

function pageLink(id: Parameters<typeof getPublicPage>[0], note: string): string {
  const page = getPublicPage(id);
  return `- [${page.h1}](${absoluteUrl(page.path)}): ${note}`;
}

export function llmsTxt(): string {
  const lines = [
    `# ${SITE_NAME}`,
    "",
    `> ${DEFINITION}`,
    "",
    DISCLAIMER,
    "",
    "## Pricing",
    "",
    priceAnswer(),
    "",
    `- ${FREE_TIER.name} (${FREE_TIER.priceLabel}): ${FREE_TIER.blurb}`,
    `- ${TIERS.report.name} (${TIERS.report.priceLabel} one-time, plus applicable taxes): ${TIERS.report.blurb}`,
    `- ${TIERS.rescan.name} (${TIERS.rescan.priceLabel} one-time, plus applicable taxes): ${TIERS.rescan.blurb}`,
    `- ${TIERS.monitor.name} (${monitoringPriceWords()}, plus applicable taxes): ${TIERS.monitor.blurb}`,
    "",
    TAX_NOTE,
    "",
    "## What VibeCheck checks",
    "",
    ISSUE_CHECKS_ANSWER,
    "",
    ...ISSUE_CHECKS.map((item) => `- ${item.title}: ${item.answer}`),
    "",
    "## Key pages",
    "",
    pageLink("home", "Product overview and the one-sentence definition."),
    pageLink("pricing", "Free teaser, full report, rescan, and monitoring."),
    pageLink("faq", "Short questions and direct answers."),
    pageLink("how-it-works", "Ownership proof, consent, and what the scan requests."),
    pageLink("guides", "Index of the security guides."),
    pageLink("guide-lovable", "What to verify on a Lovable app before launch."),
    pageLink("guide-rls", "Supabase row level security checklist."),
    pageLink("guide-keys", "How a vibe-coded app leaks an API key and what to do."),
    pageLink("demo-report", "Sample report UI with invented data, not a live scan."),
    pageLink("terms", "Terms for accounts, ownership proof, and paid plans."),
    pageLink("privacy", "Account, scan, and payment data the app stores."),
    pageLink("refund", "Refund and cancellation terms for paid plans."),
    pageLink("scanner-info", "How a scan identifies itself, and how to report abuse."),
    pageLink("contact", "Support email and the abuse mailbox."),
    `- [llms-full.txt](${absoluteUrl("/llms-full.txt")}): longer product, pricing, FAQ, and guide text for language models.`,
    "",
  ];
  return lines.join("\n");
}

export function llmsFullTxt(): string {
  const lines = [
    llmsTxt().trimEnd(),
    "",
    "## FAQ",
    "",
    ...FAQ.flatMap((item) => [`### ${item.question}`, "", item.answer, ""]),
    "## How a scan works",
    "",
    ...HOW_TO_STEPS.flatMap((step, index) => [`### ${index + 1}. ${step.heading}`, "", ...step.paragraphs, ""]),
    ...HOW_TO_EXTRAS.flatMap((step) => [`### ${step.heading}`, "", ...step.paragraphs, ""]),
    "## Guides",
    "",
  ];
  for (const id of ["guide-lovable", "guide-rls", "guide-keys"] as const) {
    const page = getPublicPage(id);
    lines.push(`### ${page.h1}`, "", page.lede, "");
    for (const section of GUIDES[id].sections) {
      lines.push(`#### ${section.heading}`, "", ...section.paragraphs, "");
      if (section.code) lines.push("```", section.code, "```", "");
    }
  }
  lines.push("## Legal pages", "");
  for (const id of ["terms", "privacy", "refund", "contact"] as const) {
    const page = getPublicPage(id);
    lines.push(`- ${page.h1}: ${absoluteUrl(page.path)} — ${page.lede}`);
  }
  lines.push("");
  return lines.join("\n");
}
