import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { sendEmail } from "./email";
import { renderMagicLinkEmail } from "./email-template";
import { magicLinkExpiresAt } from "./magic-link";
import { hashToken } from "./ownership";
import {
  SESSION_COOKIE,
  SESSION_EXPIRY_COOKIE,
  classifySession,
  sessionExpiresAt,
} from "./session-lifetime";

export { SESSION_COOKIE, SESSION_EXPIRY_COOKIE };

export async function requestMagicLink(email: string, nextPath = "/dashboard"): Promise<{ devLink?: string }> {
  const normalized = email.trim().toLowerCase();
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await prisma.magicLink.count({ where: { email: normalized, createdAt: { gt: since } } });
  if (recent >= 5) {
    throw new Error("Too many sign-in links were requested. Try again in an hour.");
  }
  const token = randomBytes(24).toString("hex");
  await prisma.magicLink.create({
    data: {
      email: normalized,
      tokenHash: hashToken(token),
      expiresAt: magicLinkExpiresAt(),
    },
  });
  const link = `${process.env.APP_URL || "http://localhost:3000"}/api/auth/verify?token=${token}&next=${encodeURIComponent(nextPath)}`;
  const message = renderMagicLinkEmail(link);
  await sendEmail({ to: normalized, subject: message.subject, text: message.text, html: message.html });
  if (process.env.DEV_EXPOSE_MAGIC_LINK === "true") return { devLink: link };
  return {};
}

export async function consumeMagicLink(token: string): Promise<{ token: string; expiresAt: Date } | null> {
  const row = await prisma.magicLink.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) return null;
  await prisma.magicLink.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  const user = await prisma.user.upsert({
    where: { email: row.email },
    update: {},
    create: { email: row.email },
  });
  const createdAt = new Date();
  const expiresAt = sessionExpiresAt(createdAt);
  const sessionToken = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(sessionToken),
      createdAt,
      expiresAt,
    },
  });
  return { token: sessionToken, expiresAt };
}

/**
 * Reads the session and does not extend it. expiresAt is fixed at sign-in.
 * A missing or elapsed row is not a user, including rows issued before the
 * 3-hour cap: those stay valid until the expiresAt they already have.
 */
export async function readSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const expiryCookie = jar.get(SESSION_EXPIRY_COOKIE)?.value;
  const row = token
    ? await prisma.session.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { user: { include: { subscription: true } } },
      })
    : null;
  const status = classifySession({
    hasSessionCookie: Boolean(token),
    expiresAt: row?.expiresAt ?? null,
    expiryCookie,
  });
  if (status === "active" && row) return { status: "active" as const, user: row.user };
  if (status === "expired") return { status: "expired" as const };
  return { status: "anonymous" as const };
}

export async function getCurrentUser() {
  const session = await readSession();
  if (session.status !== "active") return null;
  return session.user;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  jar.delete(SESSION_COOKIE);
  jar.delete(SESSION_EXPIRY_COOKIE);
}
