import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const CREDENTIAL_TTL_MS = 24 * 60 * 60 * 1000;

export class CredentialsKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialsKeyError";
  }
}

export function credentialExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + CREDENTIAL_TTL_MS);
}

/** Finished scans and expired rows are deleted. A running scan keeps its row until it finishes or the TTL hits. */
export function shouldDeleteCredential(input: { expiresAt: Date; scanStatus: string; now?: Date }): boolean {
  const now = input.now ?? new Date();
  if (input.expiresAt.getTime() <= now.getTime()) return true;
  return input.scanStatus === "completed" || input.scanStatus === "failed";
}

export function credentialsKey(): Buffer {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY?.trim() ?? "";
  if (!raw) throw new CredentialsKeyError("CREDENTIALS_ENCRYPTION_KEY is not set");
  const key = decodeKey(raw);
  if (key.length !== 32) throw new CredentialsKeyError("CREDENTIALS_ENCRYPTION_KEY must decode to 32 bytes");
  return key;
}

function decodeKey(raw: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32 && decoded.toString("base64").replace(/=+$/, "") === raw.replace(/=+$/, "")) return decoded;
  return decoded;
}

/** AES-256-GCM. The result is base64(iv || tag || ciphertext) and does not contain the plaintext. */
export function encryptCredentials(payload: unknown): string {
  const key = credentialsKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptCredentials<T>(encoded: string): T {
  const key = credentialsKey();
  const buf = Buffer.from(encoded, "base64");
  if (buf.length < 12 + 16 + 1) throw new CredentialsKeyError("Credential payload is unreadable");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    return JSON.parse(plain) as T;
  } catch {
    throw new CredentialsKeyError("Credential payload is unreadable");
  }
}
