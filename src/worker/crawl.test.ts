import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { buildCustomerReport } from "../lib/report";
import { renderFixMarkdown } from "../lib/download";
import { reportFromStored } from "../lib/stored-report";
import { ScanContext } from "./context";
import {
  classifyDiscoveredUrl,
  crawlBudget,
  findFormIssues,
  findMixedContent,
  isVerifiedOrigin,
  normalizePublicUrl,
  parseRobots,
  parseSitemapXml,
  robotsAllows,
  UrlDeduper,
  type RobotsRules,
} from "./crawl-policy";
import { isActionUrl } from "./readonly";
import { runCrawl } from "./modules/crawl";
import { runHeaders } from "./modules/headers";
import { runPageContent } from "./modules/page-content";
import { runSecrets } from "./modules/secrets";

process.env.ALLOW_LOCAL_TARGETS = "true";
process.env.PLAYWRIGHT_ENABLED = "false";
delete process.env.LOCALHOST_REWRITE_HOST;

const OPEN_RULES: RobotsRules = { allow: [], disallow: [], sitemaps: [] };

test("discovered URLs stay on the verified origin", () => {
  const origin = "https://app.example:8443";
  assert.equal(isVerifiedOrigin("https://app.example:8443/pricing", origin), true);
  assert.equal(isVerifiedOrigin("https://app.example/pricing", origin), false);
  assert.equal(isVerifiedOrigin("http://app.example:8443/pricing", origin), false);
  assert.equal(isVerifiedOrigin("https://app.example/", "https://app.example:443/"), true);
  assert.equal(isVerifiedOrigin("https://www.app.example:8443/", origin), false);
  assert.equal(isVerifiedOrigin("https://api.app.example:8443/health", origin), false);
  assert.equal(isVerifiedOrigin("https://app.example.evil:8443/", origin), false);
  assert.equal(isVerifiedOrigin("https://evil.example:8443/", origin), false);

  assert.equal(classifyDiscoveredUrl("https://api.app.example:8443/admin", origin, origin, OPEN_RULES), null);
  assert.equal(classifyDiscoveredUrl("https://evil.example/phish", origin, origin, OPEN_RULES), null);
  assert.equal(classifyDiscoveredUrl("//evil.example/phish", origin, origin, OPEN_RULES), null);
  assert.equal(classifyDiscoveredUrl("https://app.example:8443/pricing", origin, origin, OPEN_RULES), "https://app.example:8443/pricing");
});

test("action URLs and file downloads are not queued", () => {
  const origin = "http://127.0.0.1:4010";
  for (const path of ["/logout", "/signout", "/sign-out", "/account/delete", "/remove", "/destroy", "/unsubscribe", "/cancel", "/notes?action=delete"]) {
    assert.equal(isActionUrl(`${origin}${path}`), true, path);
    assert.equal(classifyDiscoveredUrl(path, origin, origin, OPEN_RULES), null, path);
  }
  assert.equal(classifyDiscoveredUrl("/files/report.pdf", origin, origin, OPEN_RULES), null);
  assert.equal(classifyDiscoveredUrl("/assets/logo.png", origin, origin, OPEN_RULES), null);
  assert.equal(classifyDiscoveredUrl("/pricing", origin, origin, OPEN_RULES), `${origin}/pricing`);
  assert.equal(isActionUrl(`${origin}/admin`), false);
});

test("crawl limits are 25 pages for a paid full scan and 5 for free or mini scans", () => {
  assert.equal(crawlBudget("full", "full").maxPages, 25);
  assert.equal(crawlBudget("full", "teaser").maxPages, 5);
  assert.equal(crawlBudget("mini", "full").maxPages, 5);
  assert.equal(crawlBudget("mini", "teaser").maxPages, 5);
  assert.ok(crawlBudget("full", "full").maxScripts > 12);
  assert.ok(crawlBudget("mini", "full").maxScripts > 12);
  assert.ok(crawlBudget("full", "full").maxRequests > crawlBudget("full", "full").maxPages);
  assert.ok(crawlBudget("full", "full").maxMs > 0);
});

test("sitemap indexes, url sets, and robots Sitemap lines parse, and our user agent is respected", () => {
  const robots = [
    "User-agent: *",
    "Disallow: /public-ok",
    "",
    "User-agent: VibeCheckScanner",
    "Disallow: /private",
    "Allow: /private/fine",
    "Sitemap: https://app.example/sitemap.xml",
    "Sitemap: https://cdn.example/other.xml",
  ].join("\n");
  const rules = parseRobots(robots, "VibeCheckScanner/0.1 (+https://scan.example/scanner-info)");
  assert.deepEqual(rules.sitemaps, ["https://app.example/sitemap.xml", "https://cdn.example/other.xml"]);
  assert.equal(robotsAllows("https://app.example/private", rules), false);
  assert.equal(robotsAllows("https://app.example/private/fine", rules), true);
  assert.equal(robotsAllows("https://app.example/public-ok", rules), true);
  assert.equal(classifyDiscoveredUrl("/private", "https://app.example", "https://app.example", rules), null);

  const index = parseSitemapXml(`<?xml version="1.0"?>
    <sitemapindex>
      <sitemap><loc>https://app.example/child.xml</loc></sitemap>
      <sitemap><loc>https://evil.example/child.xml</loc></sitemap>
    </sitemapindex>`);
  assert.deepEqual(index.sitemaps, ["https://app.example/child.xml", "https://evil.example/child.xml"]);
  assert.deepEqual(index.pages, []);

  const urlset = parseSitemapXml(`<urlset>
    <url><loc>https://app.example/from-sitemap</loc></url>
    <url><loc>https://app.example/pricing?b=1&amp;a=2</loc></url>
  </urlset>`);
  assert.deepEqual(urlset.pages, ["https://app.example/from-sitemap", "https://app.example/pricing?b=1&a=2"]);
  assert.deepEqual(urlset.sitemaps, []);
});

test("normalized URLs drop fragments, sort query keys, and cap query variants", () => {
  const origin = "https://app.example";
  assert.equal(normalizePublicUrl("/pricing?b=1&a=2#team", origin), "https://app.example/pricing?a=2&b=1");
  assert.equal(normalizePublicUrl("https://app.example/pricing/?a=2&b=1", origin), "https://app.example/pricing?a=2&b=1");
  const deduper = new UrlDeduper(3);
  const first = normalizePublicUrl("/pricing?b=1&a=2#team", origin)!;
  const second = normalizePublicUrl("/pricing?a=2&b=1#x", origin)!;
  assert.equal(first, second);
  assert.equal(deduper.accept(first), true);
  assert.equal(deduper.accept(second), false);
  assert.equal(deduper.accept("https://app.example/pricing?a=3"), true);
  assert.equal(deduper.accept("https://app.example/pricing?a=4"), true);
  assert.equal(deduper.accept("https://app.example/pricing?a=5"), false);
  assert.equal(deduper.accept("https://app.example/pricing"), true);
});

test("mixed content ignores plain links and forms on another origin are recorded", () => {
  const html = `<a href="http://elsewhere.example/go">go</a>
    <script src="http://cdn.example/app.js"></script>
    <form method="post" action="https://payments.example/charge"><input name="card"></form>`;
  assert.deepEqual(findMixedContent("https://app.example/", html), ["http://cdn.example/app.js"]);
  assert.deepEqual(findMixedContent("http://app.example/", html), []);
  const forms = findFormIssues("https://app.example/pay", html);
  assert.equal(forms.length, 1);
  assert.equal(forms[0]?.reason, "cross-origin");
  assert.equal(forms[0]?.action, "https://payments.example/charge");
});

test("the same check keeps one finding and the pages it affected", () => {
  const ctx = new ScanContext("https://app.example", "full", "full");
  const detail = (url: string) => ({
    locations: [{ method: "GET", url }],
    proof: {
      method: "GET",
      url,
      headers: [{ name: "accept", value: "text/html" }],
      status: 200,
      responseSnippet: "HTTP 200",
    },
    steps: [`Send GET ${url} with no session cookie.`],
  });
  ctx.add("missing_csp", "First page.", detail("https://app.example/"), undefined, ["https://app.example/"]);
  ctx.add("missing_csp", "Second page.", detail("https://app.example/about"), undefined, ["https://app.example/about", "https://app.example/"]);
  assert.equal(ctx.results.length, 1);
  assert.deepEqual(ctx.results[0]?.affectedPages, ["https://app.example/", "https://app.example/about"]);

  const hidden = "https://app.example/hidden-csp";
  const shown = "https://app.example/shown";
  const teaser = buildCustomerReport({
    scanId: "crawl-teaser",
    status: "completed",
    mode: "full",
    access: "teaser",
    finishedAt: new Date("2026-10-24T00:00:00.000Z"),
    pagesScanned: 5,
    marked: { missing_csp: "ok", client_backend_config: "ok" },
    results: [
      { checkId: "missing_csp", evidence: "HIDDEN_CSP", affectedPages: [hidden], ...detail(hidden) },
      { checkId: "client_backend_config", evidence: "SHOWN_CONFIG", affectedPages: [shown], ...detail(shown) },
    ],
  });
  assert.equal(teaser.pagesScanned, 5);
  assert.equal(teaser.samples.length, 1);
  assert.equal(teaser.samples[0]?.checkId, "client_backend_config");
  assert.deepEqual(teaser.samples[0]?.affectedPages, [shown]);
  assert.equal(teaser.severityCounts.medium, 1);
  assert.equal(teaser.severityCounts.info, 1);
  assert.equal(JSON.stringify(teaser).includes(hidden), false);
  assert.equal(JSON.stringify(teaser).includes("HIDDEN_CSP"), false);
  assert.match(teaser.limitations.join(" "), /subdomains/i);
  assert.match(teaser.limitations.join(" "), /page limit/i);

  const full = buildCustomerReport({
    scanId: "crawl-full",
    status: "completed",
    mode: "full",
    access: "full",
    finishedAt: new Date("2026-10-24T00:00:00.000Z"),
    pagesScanned: 25,
    marked: { missing_csp: "ok", client_backend_config: "ok" },
    results: [
      { checkId: "missing_csp", evidence: "HIDDEN_CSP", affectedPages: [hidden, shown], ...detail(hidden) },
      { checkId: "client_backend_config", evidence: "SHOWN_CONFIG", affectedPages: [shown], ...detail(shown) },
    ],
  });
  const markdown = renderFixMarkdown(full, "https://app.example");
  assert.match(markdown, /Scanned 25 pages/);
  assert.match(markdown, /Affected pages/);
  assert.match(markdown, new RegExp(hidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const stored = reportFromStored({
    scanId: "stored-crawl",
    status: "completed",
    mode: "full",
    reportAccess: "full",
    finishedAt: new Date("2026-10-24T00:00:00.000Z"),
    coverage: { marked: { missing_csp: "ok" }, pagesScanned: 3 },
    findings: [
      {
        checkId: "missing_csp",
        evidence: "HEADER",
        severity: "medium",
        title: "Content-Security-Policy header is missing",
        impact: "impact",
        fix: "fix",
        raw: { ...detail("https://app.example/"), affectedPages: ["https://app.example/", "https://app.example/about"] },
      },
    ],
  });
  assert.equal(stored.pagesScanned, 3);
  assert.deepEqual(stored.priority[0]?.affectedPages ?? stored.families[0]?.findings[0]?.affectedPages, [
    "https://app.example/",
    "https://app.example/about",
  ]);
});

test("the public crawl stays on one origin, skips action URLs, reads the sitemap, and dedupes findings", async () => {
  const hits: Array<{ method: string; host: string; path: string }> = [];
  const outsiderHits: string[] = [];
  let outsiderPort = 0;
  const outsider = createServer((req, res) => {
    outsiderHits.push(req.url || "/");
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><html><body>other origin</body></html>");
  });
  const server = createServer((req, res) => {
    const hostHeader = String(req.headers.host || "");
    const url = new URL(req.url || "/", `http://${hostHeader || "127.0.0.1"}`);
    hits.push({ method: req.method || "GET", host: hostHeader, path: `${url.pathname}${url.search}` });
    const send = (status: number, body: string, type: string) => {
      res.writeHead(status, { "content-type": type });
      res.end(body);
    };
    const host = hostHeader || `127.0.0.1:${(server.address() as AddressInfo).port}`;
    if (url.pathname === "/robots.txt") {
      send(
        200,
        ["User-agent: *", "Disallow: /private", `Sitemap: http://${host}/sitemap.xml`, "Sitemap: https://evil.example/sitemap.xml", ""].join("\n"),
        "text/plain",
      );
      return;
    }
    if (url.pathname === "/sitemap.xml") {
      send(
        200,
        `<?xml version="1.0"?><sitemapindex><sitemap><loc>http://${host}/child-sitemap.xml</loc></sitemap><sitemap><loc>https://evil.example/child.xml</loc></sitemap></sitemapindex>`,
        "application/xml",
      );
      return;
    }
    if (url.pathname === "/child-sitemap.xml") {
      send(
        200,
        `<urlset>
          <url><loc>http://${host}/from-sitemap</loc></url>
          <url><loc>https://evil.example/nope</loc></url>
          <url><loc>http://${host}/logout</loc></url>
          <url><loc>http://${host}/private</loc></url>
          <url><loc>http://${host}/files/report.pdf</loc></url>
        </urlset>`,
        "application/xml",
      );
      return;
    }
    if (url.pathname === "/assets/extra.js") {
      send(200, `const SECRET = "sk_live_abcdefghijklmnopqrstuv";\n`, "application/javascript");
      return;
    }
    if (url.pathname === "/assets/about.js") {
      send(200, `console.log("about page");\n`, "application/javascript");
      return;
    }
    if (url.pathname === "/") {
      send(
        200,
        `<!doctype html><html><body>
          <a href="/about">About</a>
          <a href="/about#team">Team</a>
          <a href="/logout">Log out</a>
          <a href="/settings/delete">Delete</a>
          <a href="/files/report.pdf">PDF</a>
          <a href="https://evil.example/phish">Phish</a>
          <a href="http://api.app.example/admin">Subdomain</a>
          <a href="http://127.0.0.1:${outsiderPort}/other">Other port</a>
        </body></html>`,
        "text/html",
      );
      return;
    }
    if (url.pathname === "/about") {
      send(
        200,
        `<!doctype html><html><body>
          <div data-key="sk_test_htmlsecretkey000000000000"></div>
          <script src="/assets/about.js"></script>
          <a href="/pricing?b=1&amp;a=2">One</a>
          <a href="/pricing?a=2&amp;b=1#x">Dup</a>
          <a href="/pricing?a=3">Three</a>
          <a href="/pricing?a=4">Four</a>
          <a href="/pricing?a=5">Five</a>
          <a href="/pricing?a=6">Six</a>
          <form method="post" action="https://payments.example/charge"><input name="card"></form>
        </body></html>`,
        "text/html",
      );
      return;
    }
    if (url.pathname === "/from-sitemap") {
      send(200, `<!doctype html><html><body><p>from sitemap</p><script src="/assets/extra.js"></script></body></html>`, "text/html");
      return;
    }
    if (url.pathname === "/pricing") {
      send(200, `<!doctype html><html><body><p>pricing ${url.search}</p></body></html>`, "text/html");
      return;
    }
    if (url.pathname === "/private" || url.pathname === "/logout" || url.pathname === "/settings/delete" || url.pathname === "/files/report.pdf") {
      send(200, "SHOULD_NOT_FETCH", "text/plain");
      return;
    }
    send(404, "missing", "text/plain");
  });

  try {
    outsiderPort = await listen(outsider);
    const port = await listen(server);
    const origin = `http://127.0.0.1:${port}`;
    const ctx = new ScanContext(origin, "full", "full");
    await runCrawl(ctx);
    await runHeaders(ctx);
    await runPageContent(ctx);
    await runSecrets(ctx);

    assert.equal(outsiderHits.length, 0);
    assert.ok(hits.every((hit) => hit.method === "GET"), hits.map((hit) => hit.method).join(","));
    assert.ok(hits.every((hit) => hit.host.startsWith(`127.0.0.1:${port}`)), hits.map((hit) => hit.host).join(","));
    const paths = hits.map((hit) => hit.path);
    for (const blocked of ["/private", "/logout", "/settings/delete", "/files/report.pdf"]) {
      assert.equal(paths.includes(blocked), false, blocked);
    }
    assert.ok(paths.includes("/from-sitemap"));
    assert.ok(paths.includes("/assets/extra.js"));
    assert.ok(paths.includes("/assets/about.js"));
    const pricing = paths.filter((path) => path.startsWith("/pricing"));
    assert.equal(pricing.length, 3, pricing.join(" | "));
    assert.equal(pricing.some((path) => path.includes("a=5") || path.includes("a=6")), false);
    assert.ok(ctx.pages.every((page) => new URL(page.url).origin === origin));
    assert.ok(ctx.pages.some((page) => page.url.endsWith("/from-sitemap")));
    assert.equal(ctx.pages.some((page) => page.url.includes("evil.example") || page.url.includes(`:${outsiderPort}`)), false);

    const csp = ctx.results.filter((result) => result.checkId === "missing_csp");
    assert.equal(csp.length, 1);
    assert.ok((csp[0]?.affectedPages?.length ?? 0) >= 2);
    assert.ok(csp[0]?.affectedPages?.some((page) => page.endsWith("/about")));
    assert.ok(csp[0]?.affectedPages?.some((page) => new URL(page).pathname === "/"));

    const secret = ctx.results.find((result) => result.checkId === "secret_in_client");
    assert.ok(secret);
    assert.ok(secret?.affectedPages?.some((page) => page.endsWith("/about")));
    assert.ok(secret?.affectedPages?.some((page) => page.endsWith("/from-sitemap")));
    assert.equal(JSON.stringify(secret).includes("sk_live_abcdefghijklmnopqrstuv"), false);
    assert.equal(JSON.stringify(secret).includes("sk_test_htmlsecretkey000000000000"), false);

    const form = ctx.results.find((result) => result.checkId === "insecure_form");
    assert.ok(form?.affectedPages?.some((page) => page.endsWith("/about")));
    assert.equal(ctx.pages.some((page) => page.url.includes("payments.example")), false);
  } finally {
    await close(server);
    await close(outsider);
  }
});

test("paid scans stop at 25 pages and free or mini scans stop at 5", async () => {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    hits.push(`${url.pathname}${url.search}`);
    const links = Array.from({ length: 40 }, (_, index) => `<a href="/n/${index + 1}">${index + 1}</a>`).join("");
    const body =
      url.pathname === "/"
        ? `<!doctype html><html><body>${links}</body></html>`
        : `<!doctype html><html><body><p>${url.pathname}</p></body></html>`;
    const type = url.pathname === "/robots.txt" || url.pathname === "/sitemap.xml" ? "text/plain" : "text/html";
    const payload = type === "text/plain" ? "missing" : body;
    res.writeHead(url.pathname === "/robots.txt" || url.pathname === "/sitemap.xml" ? 404 : 200, { "content-type": type });
    res.end(payload);
  });
  try {
    const port = await listen(server);
    const origin = `http://127.0.0.1:${port}`;
    const full = new ScanContext(origin, "full", "full");
    await runCrawl(full);
    assert.equal(full.pagesScanned, 25);
    assert.equal(hits.includes("/n/24"), true);
    assert.equal(hits.includes("/n/25"), false);
    assert.ok(hits.length <= crawlBudget("full", "full").maxRequests);

    hits.length = 0;
    const teaser = new ScanContext(origin, "full", "teaser");
    await runCrawl(teaser);
    assert.equal(teaser.pagesScanned, 5);
    assert.equal(hits.includes("/n/4"), true);
    assert.equal(hits.includes("/n/5"), false);

    hits.length = 0;
    const mini = new ScanContext(origin, "mini", "full");
    await runCrawl(mini);
    assert.equal(mini.pagesScanned, 5);
    assert.equal(hits.includes("/n/5"), false);
    assert.match(mini.notices.join(" "), /page limit/);
  } finally {
    await close(server);
  }
});

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

