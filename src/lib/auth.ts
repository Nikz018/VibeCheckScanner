import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { sendEmail } from "./email";
import { hashToken } from "./ownership";

export const SESSION_COOKIE = "vc_session";
const SESSION_DAYS = 30;

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: (process.env.APP_URL || "").startsWith("https://"),
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}

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
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });
  const link = `${process.env.APP_URL || "http://localhost:3000"}/api/auth/verify?token=${token}&next=${encodeURIComponent(nextPath)}`;
  await sendEmail(normalized, "Your VibeCheck sign-in link", `Open this link to sign in. It expires in 30 minutes.\n\n${link}`);
  if (process.env.DEV_EXPOSE_MAGIC_LINK === "true") return { devLink: link };
  return {};
}

export async function consumeMagicLink(token: string): Promise<string | null> {
  const row = await prisma.magicLink.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) return null;
  await prisma.magicLink.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  const user = await prisma.user.upsert({
    where: { email: row.email },
    update: {},
    create: { email: row.email },
  });
  const sessionToken = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(sessionToken),
      expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  return sessionToken;
}

export async function getCurrentUser() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { subscription: true } } },
  });
  if (!session || session.expiresAt.getTime() < Date.now()) return null;
  return session.user;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  jar.delete(SESSION_COOKIE);
}
