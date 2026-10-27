import { locateSecretHits, locateText } from "../extract";
import { runModule, type ScanContext } from "../context";

export const SECRET_CHECK_IDS = ["secret_in_client", "client_backend_config"] as const;

export async function runSecrets(ctx: ScanContext): Promise<void> {
  await runModule([...SECRET_CHECK_IDS], ctx, async () => {
    const htmlDocs = ctx.pages.map((page) => ({ url: page.url, body: page.body }));
    const external = ctx.scripts.filter((script) => script.url.startsWith("http"));
    const documents = htmlDocs.length > 0 ? [...htmlDocs, ...external] : ctx.scripts;
    const hits = locateSecretHits(documents);
    ctx.mark("secret_in_client");
    if (hits.length > 0) {
      const kinds = [...new Set(hits.map((hit) => hit.kind))];
      const publicKinds = findPublicVariableNote(ctx.scriptText());
      if (publicKinds) kinds.push(publicKinds);
      const primary = hits[0];
      const file = documents.find((script) => script.url === primary.url) ?? ctx.scripts.find((script) => script.url === primary.url);
      const response = {
        url: ctx.scriptUrl(primary.url),
        status: 200,
        headers: { "content-type": "application/javascript" },
        body: file?.body ?? "",
        setCookies: [],
        location: null,
      };
      ctx.add(
        "secret_in_client",
        `Public JavaScript included ${kinds.join(", ")}. The value was redacted.`,
        ctx.detailFor(response, {
          method: "GET",
          requestHeaders: { accept: "*/*" },
          locations: hits.slice(0, 6).map((hit) => ({
            method: "GET",
            url: ctx.scriptUrl(hit.url),
            line: hit.line,
            column: hit.column,
            maskedSecret: hit.masked,
          })),
          steps: [
            `Open ${ctx.scriptUrl(primary.url)} and go to line ${primary.line}, column ${primary.column}.`,
            `A private credential is there, shown here as ${primary.masked}.`,
            "Remove it from client code and rotate the credential.",
          ],
        }),
        undefined,
        affectedPagesForHits(ctx, hits.map((hit) => hit.url)),
      );
    }

    ctx.mark("client_backend_config");
    const notes: string[] = [];
    if (ctx.config.supabaseUrl) notes.push("a Supabase project URL");
    if (ctx.config.supabaseAnonKey) notes.push("a public anon client key");
    if (ctx.config.firebaseDatabaseUrl || ctx.config.firebaseProjectId) notes.push("a Firebase client config");
    if (notes.length > 0) {
      const place = locateText(ctx.scripts, /SUPABASE_URL|FIREBASE_DATABASE_URL|FIREBASE_PROJECT_ID|supabase\.co|firebaseio\.com/);
      const file = place ? ctx.scripts.find((script) => script.url === place.url) : ctx.scripts[0];
      const url = ctx.scriptUrl(place?.url || file?.url || ctx.targetUrl);
      const affected = ctx.pagesMatching(/SUPABASE_URL|FIREBASE_DATABASE_URL|FIREBASE_PROJECT_ID|supabase\.co|firebaseio\.com/);
      ctx.add(
        "client_backend_config",
        `The public bundle embeds ${notes.join(" and ")}. A client key is expected only when server-side rules reject unauthorized access.`,
        ctx.detailFor(
          {
            url,
            status: 200,
            headers: { "content-type": "application/javascript" },
            body: file?.body ?? "",
            setCookies: [],
            location: null,
          },
          {
            locations: [
              {
                method: "GET",
                url,
                line: place?.line,
                column: place?.column,
              },
            ],
            steps: [
              `Open ${url}${place ? ` at line ${place.line}` : ""}.`,
              "The client config names the backend project. Confirm server rules reject anonymous reads and writes.",
            ],
          },
        ),
        undefined,
        affected,
      );
    }
  });
}

function affectedPagesForHits(ctx: ScanContext, urls: string[]): string[] {
  const pages: string[] = [];
  const add = (url: string) => {
    if (!url.startsWith("http") || pages.includes(url)) return;
    pages.push(url);
  };
  for (const url of urls) {
    const script = ctx.scripts.find((item) => item.url === url);
    if (script?.pageUrls?.length) {
      for (const page of script.pageUrls) add(page);
      continue;
    }
    add(ctx.scriptUrl(url));
  }
  return pages;
}

function findPublicVariableNote(source: string): string | null {
  if (/(?:NEXT_PUBLIC|VITE)_[A-Z0-9_]*(?:SECRET|SERVICE_ROLE|PRIVATE)/.test(source)) {
    return "a NEXT_PUBLIC_ or VITE_ variable holding a private key";
  }
  if (/(?:NEXT_PUBLIC|VITE)_[A-Z0-9_]*\s*=\s*["'](?:sk_live_|sk_test_|sk-|re_|AKIA)/.test(source)) {
    return "a NEXT_PUBLIC_ or VITE_ variable holding a private key";
  }
  return null;
}
