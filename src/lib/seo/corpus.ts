import { FAQ, ISSUE_CHECKS, PUBLIC_PAGES, allCopyBlocks, type PublicPageId } from "./content";
import { jsonLdForPage } from "./jsonld";
import { llmsFullTxt, llmsTxt } from "./llms";

export function publicCopyCorpus(): string {
  const pages = PUBLIC_PAGES.map((page) => [page.title, page.absoluteTitle ?? "", page.description, page.h1, page.lede].join("\n")).join("\n");
  const faqs = FAQ.map((item) => `${item.question}\n${item.answer}`).join("\n");
  const issues = ISSUE_CHECKS.map((item) => `${item.title}\n${item.answer}`).join("\n");
  const blocks = allCopyBlocks()
    .map((block) => [block.heading, ...block.paragraphs, block.code ?? ""].join("\n"))
    .join("\n");
  const ids = PUBLIC_PAGES.map((page) => page.id as PublicPageId);
  const structured = ids.map((id) => JSON.stringify(jsonLdForPage(id))).join("\n");
  return [pages, faqs, issues, blocks, structured, llmsTxt(), llmsFullTxt()].join("\n");
}
