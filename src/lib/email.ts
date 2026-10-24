import nodemailer from "nodemailer";

export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[email skipped] To: ${to}\nSubject: ${subject}\n${text}`);
    }
    return false;
  }
  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_PORT === "465",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || "VibeCheck <scans@localhost>",
    to,
    subject,
    text,
  });
  return true;
}
