import { formatMagicLinkTtl } from "./magic-link";
import { abuseContactEmail } from "./scanner-identity";
import { getSiteUrl, normalizeSiteUrl } from "./seo/site";

export const MAGIC_LINK_SUBJECT = "Your VibeCheck sign-in link";
export const MONITOR_ALERT_SUBJECT = "VibeCheck found new high-severity issues";
export const SIGN_IN_BUTTON_LABEL = "Sign in to VibeCheck";
export const IGNORE_UNSOLICITED_SIGN_IN = "If you didn't request this, you can ignore this email.";

const NAVY = "#071018";
const PAPER = "#f4f7fb";
const LIME = "#dff25b";
const GLOW = "#3ec6ff";
const INK = "#071018";
const MUTED = "#3d4c5f";
const LINK = "#0c4a6e";
const FONT = "Arial,Helvetica,sans-serif";
const DISPLAY = "Georgia,'Times New Roman',serif";

export interface EmailAction {
  href: string;
  label: string;
}

export interface EmailBrandOptions {
  siteUrl?: string;
  abuseEmail?: string;
}

export interface TransactionalEmailInput extends EmailBrandOptions {
  documentTitle?: string;
  preheader: string;
  greeting?: string;
  paragraphs: string[];
  action?: EmailAction | null;
  notes?: string[];
}

export interface RenderedEmail {
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeMultiline(value: string): string {
  return escapeHtml(value).replace(/\r\n|\r|\n/g, "<br>");
}

/** http(s) URL safe to place in an href. Rejects other schemes and embedded credentials. */
export function safeHttpUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /[\u0000-\u001F\u007F]/.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return url.toString();
}

function resolveSiteUrl(explicit?: string): string {
  if (explicit !== undefined) return normalizeSiteUrl(explicit);
  return getSiteUrl();
}

function resolveAbuseEmail(explicit?: string): string {
  if (explicit !== undefined) return abuseContactEmail(explicit);
  return abuseContactEmail();
}

function buttonWidth(label: string): number {
  return Math.min(460, Math.max(260, label.length * 10 + 72));
}

function msoHref(url: string): string {
  return escapeHtml(url.replaceAll("--", "%2D%2D"));
}

function renderButton(href: string, label: string): string {
  const labelHtml = escapeHtml(label);
  const hrefHtml = escapeHtml(href);
  const width = buttonWidth(label);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" class="btn" style="margin:24px auto 0;">
  <tr>
    <td align="center" bgcolor="${LIME}" style="background-color:${LIME};border-radius:999px;">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${msoHref(href)}" style="height:48px;v-text-anchor:middle;width:${width}px;" arcsize="50%" strokecolor="${LIME}" fillcolor="${LIME}">
        <w:anchorlock/>
        <center style="color:${INK};font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${labelHtml.replaceAll("--", "&#45;&#45;")}</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a href="${hrefHtml}" class="btn-link" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:700;line-height:20px;color:${INK};text-decoration:none;border-radius:999px;background-color:${LIME};">${labelHtml}</a>
      <!--<![endif]-->
    </td>
  </tr>
</table>`;
}

function renderHtml(input: TransactionalEmailInput, siteUrl: string, abuseEmail: string, action: EmailAction | null): string {
  const title = escapeHtml(input.documentTitle || "VibeCheck");
  const preheader = escapeHtml(input.preheader);
  const pad = "&#847;&zwnj;&nbsp;".repeat(80);
  const greeting = input.greeting === "" ? "" : escapeHtml(input.greeting ?? "Hi,");
  const paragraphs = input.paragraphs.filter((paragraph) => paragraph.trim().length > 0).map(escapeMultiline);
  const notes = (input.notes ?? []).filter((note) => note.trim().length > 0).map(escapeMultiline);
  const siteHtml = escapeHtml(siteUrl);
  const abuseHtml = escapeHtml(abuseEmail);

  const greetingHtml = greeting
    ? `<p class="ink" style="margin:20px 0 0;font-family:${FONT};font-size:16px;line-height:24px;color:${INK};">${greeting}</p>`
    : "";
  const paragraphHtml = paragraphs
    .map(
      (paragraph) =>
        `<p class="ink" style="margin:16px 0 0;font-family:${FONT};font-size:16px;line-height:24px;color:${INK};">${paragraph}</p>`,
    )
    .join("\n");
  const actionHtml = action
    ? `${renderButton(action.href, action.label)}
<p class="muted" style="margin:20px 0 0;font-family:${FONT};font-size:14px;line-height:22px;color:${MUTED};">Or copy this link:</p>
<p class="link" style="margin:8px 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${LINK};word-break:break-all;overflow-wrap:anywhere;"><a href="${escapeHtml(action.href)}" style="color:${LINK};text-decoration:underline;">${escapeHtml(action.href)}</a></p>`
    : "";
  const notesHtml = notes
    .map(
      (note) =>
        `<p class="ink" style="margin:16px 0 0;font-family:${FONT};font-size:14px;line-height:22px;color:${INK};">${note}</p>`,
    )
    .join("\n");
  const abuseBlock = abuseHtml
    ? `<p class="muted" style="margin:8px 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${MUTED};">Support and abuse: <a href="mailto:${abuseHtml}" style="color:${MUTED};text-decoration:underline;">${abuseHtml}</a></p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
  <title>${title}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <style type="text/css">
    table, td { font-family: Arial, Helvetica, sans-serif; }
  </style>
  <![endif]-->
  <style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
    @media (prefers-color-scheme: dark) {
      .body-bg { background-color: ${NAVY} !important; }
      .card, .card-inner { background-color: ${PAPER} !important; }
      .glow { background-color: ${GLOW} !important; }
      .mark { background-color: ${LIME} !important; color: ${INK} !important; }
      .ink { color: ${INK} !important; }
      .muted, .muted a { color: ${MUTED} !important; }
      .link, .link a { color: ${LINK} !important; }
      .btn, .btn td, .btn a, a.btn-link { background-color: ${LIME} !important; color: ${INK} !important; }
    }
    [data-ogsc] .card, [data-ogsc] .card-inner { background-color: ${PAPER} !important; }
    [data-ogsc] .ink { color: ${INK} !important; }
    [data-ogsc] .muted, [data-ogsc] .muted a { color: ${MUTED} !important; }
    [data-ogsc] .link, [data-ogsc] .link a { color: ${LINK} !important; }
    [data-ogsc] .btn a, [data-ogsc] a.btn-link { background-color: ${LIME} !important; color: ${INK} !important; }
    [data-ogsb].body-bg { background-color: ${NAVY} !important; }
    u + .body .card-inner { background-color: ${PAPER} !important; }
    u + .body .ink { color: ${INK} !important; }
    u + .body .btn a { background-color: ${LIME} !important; color: ${INK} !important; }
  </style>
</head>
<body class="body body-bg" bgcolor="${NAVY}" style="margin:0;padding:0;width:100%;background-color:${NAVY};">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${NAVY};">${preheader}${pad}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="body-bg" bgcolor="${NAVY}" style="width:100%;background-color:${NAVY};">
    <tr>
      <td align="center" bgcolor="${NAVY}" style="background-color:${NAVY};padding:32px 16px;">
        <!--[if mso]>
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td>
        <![endif]-->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">
          <tr>
            <td class="card" bgcolor="${PAPER}" style="background-color:${PAPER};border-radius:24px;border:1px solid #d5e0ee;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="glow" height="4" bgcolor="${GLOW}" style="height:4px;background-color:${GLOW};font-size:0;line-height:4px;">&nbsp;</td>
                </tr>
                <tr>
                  <td class="card-inner" bgcolor="${PAPER}" style="background-color:${PAPER};padding:28px 32px 32px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td class="mark" width="36" height="36" align="center" valign="middle" bgcolor="${LIME}" style="width:36px;height:36px;background-color:${LIME};color:${INK};font-family:${DISPLAY};font-size:14px;font-weight:700;line-height:36px;border-radius:10px;mso-line-height-rule:exactly;">VC</td>
                        <td width="12" style="width:12px;font-size:0;line-height:0;">&nbsp;</td>
                        <td class="ink" valign="middle" style="font-family:${DISPLAY};font-size:22px;font-weight:700;line-height:28px;color:${INK};">VibeCheck</td>
                      </tr>
                    </table>
                    ${greetingHtml}
                    ${paragraphHtml}
                    ${actionHtml}
                    ${notesHtml}
                    <p class="muted" style="margin:28px 0 0;padding-top:16px;border-top:1px solid #d5e0ee;font-family:${FONT};font-size:13px;line-height:20px;color:${MUTED};"><a href="${siteHtml}" style="color:${MUTED};text-decoration:underline;">${siteHtml}</a></p>
                    ${abuseBlock}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <!--[if mso]>
        </td></tr></table>
        <![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

function renderText(input: TransactionalEmailInput, siteUrl: string, abuseEmail: string, action: EmailAction | null): string {
  const lines: string[] = ["VibeCheck", ""];
  const greeting = input.greeting === "" ? "" : (input.greeting ?? "Hi,");
  if (greeting) lines.push(greeting, "");
  for (const paragraph of input.paragraphs) {
    if (paragraph.trim()) lines.push(paragraph.trim(), "");
  }
  if (action) {
    lines.push(action.label, "Or copy this link:", action.href, "");
  }
  for (const note of input.notes ?? []) {
    if (note.trim()) lines.push(note.trim(), "");
  }
  lines.push(siteUrl);
  if (abuseEmail) lines.push(`Support and abuse: ${abuseEmail}`);
  return `${lines.join("\n").trim()}\n`;
}

export function renderTransactionalEmail(input: TransactionalEmailInput): RenderedEmail {
  const siteUrl = resolveSiteUrl(input.siteUrl);
  const abuseEmail = resolveAbuseEmail(input.abuseEmail);
  const href = input.action ? safeHttpUrl(input.action.href) : null;
  const action = input.action && href ? { href, label: input.action.label } : null;
  return {
    html: renderHtml(input, siteUrl, abuseEmail, action),
    text: renderText(input, siteUrl, abuseEmail, action),
  };
}

export function renderMagicLinkEmail(link: string, options: EmailBrandOptions = {}): RenderedEmail & { subject: string } {
  const expiresIn = formatMagicLinkTtl();
  const intro = "Use this link to sign in to VibeCheck.";
  const rendered = renderTransactionalEmail({
    documentTitle: MAGIC_LINK_SUBJECT,
    preheader: `${intro} It expires in ${expiresIn}.`,
    paragraphs: [intro],
    action: { href: link, label: SIGN_IN_BUTTON_LABEL },
    notes: [`This link expires in ${expiresIn}.`, IGNORE_UNSOLICITED_SIGN_IN],
    siteUrl: options.siteUrl,
    abuseEmail: options.abuseEmail,
  });
  return { subject: MAGIC_LINK_SUBJECT, ...rendered };
}

export function monitorAlertMessage(host: string, count: number): string {
  const noun = count === 1 ? "issue" : "issues";
  return `A monitored scan of ${host} found ${count} new high-severity ${noun}. Open the latest scan to review them.`;
}

export function renderMonitorAlertEmail(
  host: string,
  count: number,
  scanUrl: string,
  options: EmailBrandOptions = {},
): RenderedEmail & { subject: string; message: string } {
  const message = monitorAlertMessage(host, count);
  const rendered = renderTransactionalEmail({
    documentTitle: MONITOR_ALERT_SUBJECT,
    preheader: message,
    paragraphs: [message],
    action: { href: scanUrl, label: "Open the latest scan" },
    siteUrl: options.siteUrl,
    abuseEmail: options.abuseEmail,
  });
  return { subject: MONITOR_ALERT_SUBJECT, message, ...rendered };
}
