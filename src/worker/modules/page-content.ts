import { reproduce } from "@/lib/finding-detail";
import { findFormIssues, findMixedContent } from "../crawl-policy";
import { runModule, type ScanContext } from "../context";

export const PAGE_CONTENT_CHECK_IDS = ["mixed_content", "insecure_form"] as const;

const FORM_REASON: Record<string, string> = {
  "https-downgrade": "submits from HTTPS to an HTTP URL",
  "cross-origin": "submits to a different origin",
  "password-over-http": "asks for a password over HTTP",
};

export async function runPageContent(ctx: ScanContext): Promise<void> {
  await runModule([...PAGE_CONTENT_CHECK_IDS], ctx, async () => {
    const pages = ctx.pages.length > 0 ? ctx.pages : ctx.home ? [ctx.home] : [];
    const mixed: Array<{ page: string; resource: string }> = [];
    const forms: Array<{ page: string; action: string; reason: string }> = [];
    for (const page of pages) {
      for (const resource of findMixedContent(page.url, page.body)) mixed.push({ page: page.url, resource });
      for (const issue of findFormIssues(page.url, page.body)) {
        forms.push({ page: page.url, action: issue.action, reason: issue.reason });
      }
    }

    ctx.mark("mixed_content");
    if (mixed.length > 0) {
      const affected = unique(mixed.map((hit) => hit.page));
      const first = pages.find((page) => page.url === mixed[0].page) ?? pages[0];
      const sample = mixed[0].resource;
      ctx.add(
        "mixed_content",
        `${pagePhrase(affected.length)} loaded a resource over HTTP.`,
        ctx.detailFor(first, {
          requestHeaders: { accept: "text/html" },
          locations: mixed.slice(0, 6).map((hit) => ({ method: "GET", url: hit.page })),
          steps: reproduce(
            "GET",
            first.url,
            `The page references ${sample}.`,
            "Serve that resource over HTTPS and update the page.",
          ),
        }),
        undefined,
        affected,
      );
    }

    ctx.mark("insecure_form");
    if (forms.length > 0) {
      const affected = unique(forms.map((hit) => hit.page));
      const reasons = unique(forms.map((hit) => FORM_REASON[hit.reason] ?? "submits insecurely"));
      const first = pages.find((page) => page.url === forms[0].page) ?? pages[0];
      ctx.add(
        "insecure_form",
        `${pagePhrase(affected.length)} has a form that ${reasons.join(" and ")}.`,
        ctx.detailFor(first, {
          requestHeaders: { accept: "text/html" },
          locations: forms.slice(0, 6).map((hit) => ({ method: "GET", url: hit.page })),
          steps: reproduce(
            "GET",
            first.url,
            `The form action is ${forms[0].action}. The scan did not submit the form.`,
            "Post the form to this origin over HTTPS.",
          ),
        }),
        undefined,
        affected,
      );
    }
  });
}

function pagePhrase(count: number): string {
  return `${count} scanned ${count === 1 ? "page" : "pages"}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
