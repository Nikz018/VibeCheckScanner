import { z } from "zod";

export interface AuthAccount {
  label: "A" | "B";
  loginUrl: string;
  username: string;
  password: string;
  cookie: string;
  bearerToken: string;
}

export interface AuthScanPayload {
  consent: true;
  accounts: AuthAccount[];
}

export class AuthInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthInputError";
  }
}

const accountSchema = z.object({
  label: z.enum(["A", "B"]),
  loginUrl: z.string().trim().max(500),
  username: z.string().trim().max(200).optional().default(""),
  password: z.string().max(200).optional().default(""),
  cookie: z.string().max(4096).optional().default(""),
  bearerToken: z.string().max(4096).optional().default(""),
});

const authScanSchema = z
  .object({
    consent: z.literal(true),
    accounts: z.array(accountSchema).min(1).max(2),
  })
  .strict();

export function parseAuthScan(input: unknown, targetOrigin: string): AuthScanPayload {
  const parsed = authScanSchema.safeParse(input);
  if (!parsed.success) {
    throw new AuthInputError("Provide one or two test accounts and confirm they are throwaway accounts.");
  }
  const labels = new Set<string>();
  const accounts: AuthAccount[] = [];
  for (const account of parsed.data.accounts) {
    if (labels.has(account.label)) throw new AuthInputError("Use each account label once.");
    labels.add(account.label);
    const loginUrl = assertLoginUrl(account.loginUrl, targetOrigin);
    const passwordLogin = account.username.length > 0 && account.password.length > 0;
    const session = account.cookie.trim().length > 0 || account.bearerToken.trim().length > 0;
    if (!passwordLogin && !session) {
      throw new AuthInputError("Each test account needs a username and password, or a session cookie or bearer token.");
    }
    accounts.push({
      label: account.label,
      loginUrl,
      username: account.username,
      password: account.password,
      cookie: account.cookie.trim(),
      bearerToken: account.bearerToken.trim(),
    });
  }
  return { consent: true, accounts };
}

function assertLoginUrl(raw: string, targetOrigin: string): string {
  let url: URL;
  let origin: URL;
  try {
    url = new URL(raw);
    origin = new URL(targetOrigin);
  } catch {
    throw new AuthInputError("The login URL has to be on the verified origin.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AuthInputError("The login URL has to be on the verified origin.");
  }
  if (url.username || url.password || url.origin !== origin.origin) {
    throw new AuthInputError("The login URL has to be on the verified origin.");
  }
  return url.toString();
}
