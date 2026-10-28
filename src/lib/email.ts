import nodemailer from "nodemailer";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface BuiltEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

function headerValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** Dev log line. Never includes the body, a URL, or a token. */
export function emailSkipLog(to: string, subject: string): string {
  const scrub = (value: string) => (/https?:|token=/i.test(value) ? "(omitted)" : headerValue(value));
  return `[email skipped] to=${scrub(to)} subject=${scrub(subject)}`;
}

export function emailFromAddress(raw = process.env.EMAIL_FROM): string {
  const value = headerValue(raw ?? "");
  return value || "VibeCheck <scans@localhost>";
}

export function buildEmailOptions(message: EmailMessage): BuiltEmail {
  return {
    from: emailFromAddress(),
    to: headerValue(message.to),
    subject: headerValue(message.subject),
    text: message.text,
    html: message.html,
  };
}

export async function sendEmail(message: EmailMessage): Promise<boolean> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    if (process.env.NODE_ENV !== "production") {
      console.info(emailSkipLog(message.to, message.subject));
    }
    return false;
  }
  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_PORT === "465",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  await transporter.sendMail(buildEmailOptions(message));
  return true;
}
