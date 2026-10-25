import { SESSION_COOKIE } from "./auth";
import { pdfFooterTemplate, pdfHeaderTemplate } from "./download";

export async function renderReportPdf(printUrl: string, sessionToken: string): Promise<Buffer> {
  const playwright = await import("playwright");
  const channel = process.env.PLAYWRIGHT_CHANNEL?.trim();
  const browser = await playwright.chromium.launch({
    headless: true,
    timeout: 15000,
    ...(channel ? { channel: channel as "chrome" } : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: SESSION_COOKIE,
        value: sessionToken,
        url: new URL(printUrl).origin,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(20000);
    const response = await page.goto(printUrl, { waitUntil: "domcontentloaded" });
    if (!response || response.status() !== 200) {
      throw new Error(`print page returned ${response?.status() ?? "no response"}`);
    }
    await page.locator("[data-report='vibecheck-print']").waitFor({ timeout: 10000 });
    await page.emulateMedia({ media: "print" });
    const pdf = await Promise.race([
      page.pdf({
        format: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: pdfHeaderTemplate(),
        footerTemplate: pdfFooterTemplate(),
        margin: { top: "16mm", bottom: "24mm", left: "12mm", right: "12mm" },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("pdf timed out")), 25000)),
    ]);
    return scrubPdfToolMetadata(Buffer.from(pdf));
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/** Chromium stamps its user agent into the PDF Info dictionary. Replace those
 * literal strings in place so the xref offsets stay valid. */
export function scrubPdfToolMetadata(pdf: Buffer): Buffer {
  const out = Buffer.from(pdf);
  for (const key of ["/Creator", "/Producer"]) rewriteInfoString(out, key);
  return out;
}

function rewriteInfoString(buf: Buffer, key: string): void {
  const marker = Buffer.from(`${key} (`);
  const start = buf.indexOf(marker);
  if (start < 0 || start > 8192) return;
  const valueStart = start + marker.length;
  let i = valueStart;
  const limit = Math.min(buf.length, valueStart + 2000);
  while (i < limit) {
    if (buf[i] === 0x5c) {
      i += 2;
      continue;
    }
    if (buf[i] === 0x29) {
      const len = i - valueStart;
      const label = Buffer.from("VibeCheck");
      const replacement = Buffer.alloc(len, 0x20);
      label.copy(replacement, 0, 0, Math.min(label.length, len));
      replacement.copy(buf, valueStart);
      return;
    }
    i += 1;
  }
}
