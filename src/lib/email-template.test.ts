import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import MailComposer from "nodemailer/lib/mail-composer";
import { buildEmailOptions, emailSkipLog, sendEmail } from "./email";
import {
  IGNORE_UNSOLICITED_SIGN_IN,
  MAGIC_LINK_SUBJECT,
  SIGN_IN_BUTTON_LABEL,
  escapeHtml,
  renderMagicLinkEmail,
  renderMonitorAlertEmail,
  renderTransactionalEmail,
  safeHttpUrl,
} from "./email-template";
import { MAGIC_LINK_TTL_MS, formatMagicLinkTtl } from "./magic-link";
import { paidReportNotice } from "./payments/paid-scan-status";
import { containsToolBrand } from "./sanitize";

const LINK = "https://scan.example/api/auth/verify?token=abc&next=%2Fdashboard";
const BRAND = { siteUrl: "https://scan.example", abuseEmail: "abuse@example.com" };

test("magic-link expiry follows the configured lifetime", () => {
  assert.equal(MAGIC_LINK_TTL_MS, 30 * 60 * 1000);
  assert.equal(formatMagicLinkTtl(), "30 minutes");
  assert.equal(formatMagicLinkTtl(MAGIC_LINK_TTL_MS), "30 minutes");
  assert.equal(formatMagicLinkTtl(60 * 1000), "1 minute");
  assert.equal(formatMagicLinkTtl(15 * 60 * 1000), "15 minutes");
  assert.equal(formatMagicLinkTtl(2 * 60 * 60 * 1000), "2 hours");
  assert.equal(formatMagicLinkTtl(Number.NaN), "30 minutes");

  const template = readFileSync(new URL("./email-template.ts", import.meta.url), "utf8");
  const auth = readFileSync(new URL("./auth.ts", import.meta.url), "utf8");
  assert.match(template, /formatMagicLinkTtl\(\)/);
  assert.doesNotMatch(template, /30 minutes/);
  assert.match(auth, /magicLinkExpiresAt\(/);
  assert.match(auth, /renderMagicLinkEmail\(/);
  assert.doesNotMatch(auth, /30 \* 60 \* 1000/);
  assert.doesNotMatch(auth, /expires in 30 minutes/);
});

test("magic-link email includes the link, expiry, button, and plain-text part", () => {
  const mail = renderMagicLinkEmail(LINK, BRAND);
  assert.equal(mail.subject, MAGIC_LINK_SUBJECT);
  assert.equal(mail.subject, "Your VibeCheck sign-in link");
  assert.match(mail.html, /href="https:\/\/scan\.example\/api\/auth\/verify\?token=abc&amp;next=%2Fdashboard"/);
  assert.match(mail.text, /https:\/\/scan\.example\/api\/auth\/verify\?token=abc&next=%2Fdashboard/);
  assert.match(mail.html, /This link expires in 30 minutes/);
  assert.match(mail.text, /This link expires in 30 minutes/);
  assert.match(mail.html, new RegExp(`>${SIGN_IN_BUTTON_LABEL}</a>`));
  assert.equal(mail.html.match(/<a [^>]*>Sign in to VibeCheck<\/a>/g)?.length, 1);
  assert.match(mail.html, /Or copy this link:/);
  assert.match(mail.text, /Or copy this link:\nhttps:\/\/scan\.example\/api\/auth\/verify\?token=abc&next=%2Fdashboard/);
  assert.match(mail.html, /Hi,/);
  assert.match(mail.text, /^VibeCheck\n\nHi,/);
  assert.match(mail.html, />VC</);
  assert.match(mail.html, />VibeCheck</);
  assert.match(mail.html, /role="presentation"/);
  assert.match(mail.html, /bgcolor="#071018"/);
  assert.match(mail.html, /bgcolor="#f4f7fb"/);
  assert.match(mail.html, /bgcolor="#dff25b"/);
  assert.match(mail.html, /bgcolor="#3ec6ff"/);
  assert.match(mail.html, /name="color-scheme" content="light dark"/);
  assert.match(mail.html, /name="supported-color-schemes" content="light dark"/);
  assert.match(mail.html, /prefers-color-scheme:\s*dark/);
  assert.match(mail.html, /\[data-ogsc\]/);
  assert.match(mail.text, /https:\/\/scan\.example/);
  assert.match(mail.html, /https:\/\/scan\.example/);
  assert.match(mail.text, /Support and abuse: abuse@example.com/);
  assert.match(mail.html, /mailto:abuse@example.com/);
  assert.match(mail.html, /If you didn(?:'|&#39;)t request this, you can ignore this email/);
  assert.match(mail.text, new RegExp(IGNORE_UNSOLICITED_SIGN_IN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(containsToolBrand(`${mail.subject}\n${mail.text}\n${mail.html}`), null);
  assert.equal(mail.html.includes("contact@example.com"), false);
  assert.equal(mail.text.includes("contact@example.com"), false);

  const hidden = mail.html.match(/<div style="display:none;[^"]*">([\s\S]*?)<\/div>/);
  assert.ok(hidden);
  assert.match(hidden[1], /It expires in 30 minutes/);
  assert.equal(hidden[1].includes("token=abc"), false);
  assert.match(hidden[1], /max-height:0|&#847;/);
});

test("transactional html escapes dynamic values and drops unsafe links", () => {
  const hostile = `bad.example"><script>alert(1)</script>`;
  const rendered = renderTransactionalEmail({
    documentTitle: `Hello <b> & "quotes"`,
    preheader: `Preview <script> & "quotes"`,
    greeting: `Hi <b>`,
    paragraphs: [`A <script>alert(1)</script> & "quote"`],
    action: { href: `https://scan.example/a?x=1&y=<tag>`, label: `Open <b>` },
    notes: [`Note <b> & "x"`],
    siteUrl: "https://scan.example",
    abuseEmail: "abuse@example.com",
  });
  assert.equal(rendered.html.includes("<script>"), false);
  assert.equal(rendered.html.includes("<b>"), false);
  assert.match(rendered.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(rendered.html, /&amp;/);
  assert.match(rendered.html, /&quot;quote&quot;/);
  assert.match(rendered.html, /href="https:\/\/scan\.example\/a\?x=1&amp;y=%3Ctag%3E"/);
  assert.match(rendered.text, /<script>alert\(1\)<\/script>/);
  assert.match(rendered.text, /https:\/\/scan\.example\/a\?x=1&y=%3Ctag%3E/);
  assert.equal(rendered.text.includes("&amp;"), false);
  assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");

  const report = paidReportNotice(hostile, "https://scan.example/scans/scan_1");
  assert.match(report.text, /The full report for bad\.example"><script>alert\(1\)<\/script> is ready/);
  assert.match(report.text, /https:\/\/scan\.example\/scans\/scan_1/);
  assert.equal(report.html.includes("<script>"), false);
  assert.match(report.html, /&lt;script&gt;/);
  assert.match(report.html, />Open the full report<\/a>/);
  assert.equal(containsToolBrand(`${report.subject}\n${report.text}`), null);

  const alert = renderMonitorAlertEmail(hostile, 2, "https://scan.example/scans/scan_1", {
    siteUrl: "https://scan.example",
    abuseEmail: "",
  });
  assert.equal(alert.subject, "VibeCheck found new high-severity issues");
  assert.match(alert.message, /2 new high-severity issues/);
  assert.match(alert.text, /A monitored scan of bad\.example"><script>alert\(1\)<\/script> found 2 new high-severity issues/);
  assert.match(alert.text, /https:\/\/scan\.example\/scans\/scan_1/);
  assert.equal(alert.html.includes("<script>"), false);
  assert.match(alert.html, /&lt;script&gt;/);
  assert.equal(alert.html.includes("Support and abuse"), false);
  assert.equal(alert.text.includes("contact@example.com"), false);
  assert.equal(containsToolBrand(`${alert.subject}\n${alert.message}\n${alert.text}\n${alert.html}`), null);

  const singular = renderMonitorAlertEmail("app.example", 1, "https://scan.example/scans/scan_1", {
    siteUrl: "https://scan.example",
    abuseEmail: "",
  });
  assert.match(singular.message, /found 1 new high-severity issue\./);
  assert.doesNotMatch(singular.message, /issues/);

  const scriptLink = renderTransactionalEmail({
    preheader: "Hello",
    paragraphs: ["Body"],
    action: { href: "javascript:alert(1)", label: "Sign in to VibeCheck" },
    siteUrl: "https://scan.example",
    abuseEmail: "not an email",
  });
  assert.equal(scriptLink.html.toLowerCase().includes("javascript:"), false);
  assert.equal(scriptLink.text.toLowerCase().includes("javascript:"), false);
  assert.equal(scriptLink.html.includes("not an email"), false);
  assert.equal(safeHttpUrl("https://user:pass@scan.example/secret"), null);
  assert.equal(safeHttpUrl("javascript:alert(1)"), null);
});

test("multipart message carries html and text without logging the link", async () => {
  const mail = renderMagicLinkEmail(LINK, { siteUrl: "https://scan.example", abuseEmail: "" });
  const previousFrom = process.env.EMAIL_FROM;
  process.env.EMAIL_FROM = "VibeCheck <login@example.com>";
  try {
    const options = buildEmailOptions({
      to: "person@example.com",
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    assert.equal(options.from, "VibeCheck <login@example.com>");
    assert.equal(options.text, mail.text);
    assert.equal(options.html, mail.html);
    assert.match(options.text, /token=abc&next=/);
    assert.match(options.html, /token=abc&amp;next=/);
    const raw = await new MailComposer(options).compile().build();
    const source = raw.toString("utf8");
    assert.match(source, /multipart\/alternative/i);
    assert.match(source, /text\/plain/i);
    assert.match(source, /text\/html/i);
    assert.ok(source.includes("token=abc") || source.includes("token=3Dabc"));
    assert.match(source, /30 minutes/);
  } finally {
    if (previousFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = previousFrom;
  }

  const previousHost = process.env.SMTP_HOST;
  const previousNode = process.env.NODE_ENV;
  const env = process.env as Record<string, string | undefined>;
  delete env.SMTP_HOST;
  env.NODE_ENV = "development";
  const lines: string[] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    const sent = await sendEmail({
      to: "person@example.com",
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    assert.equal(sent, false);
    const logged = lines.join("\n");
    assert.match(logged, /email skipped/);
    assert.match(logged, /Your VibeCheck sign-in link/);
    assert.equal(logged.includes("token=abc"), false);
    assert.equal(logged.includes(LINK), false);
    assert.equal(logged.includes("verify?token"), false);
    assert.equal(logged.includes("<table"), false);
    assert.equal(emailSkipLog("person@example.com", "https://scan.example/api/auth/verify?token=secret"), "[email skipped] to=person@example.com subject=(omitted)");
  } finally {
    console.info = original;
    if (previousHost === undefined) delete env.SMTP_HOST;
    else env.SMTP_HOST = previousHost;
    if (previousNode === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previousNode;
  }

  const execute = readFileSync(new URL("../worker/execute.ts", import.meta.url), "utf8");
  const emailSource = readFileSync(new URL("./email.ts", import.meta.url), "utf8");
  assert.match(execute, /renderMonitorAlertEmail/);
  assert.match(execute, /notice\.html/);
  assert.doesNotMatch(execute, /sendEmail\(email,/);
  assert.match(emailSource, /emailSkipLog\(message\.to, message\.subject\)/);
  assert.doesNotMatch(emailSource, /\$\{(?:text|html|message\.text|message\.html)\}/);
});
