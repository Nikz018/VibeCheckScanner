import { prisma } from "./db";

export type AuthorizationKind = "ownership" | "consent";
export type AuthorizationMethod = "well_known" | "dns_txt" | "checkbox" | "monitor_enable" | "monitor_schedule";

export interface AuthorizationInput {
  userId: string;
  userEmail: string;
  projectId?: string | null;
  scanId?: string | null;
  targetUrl: string;
  kind: AuthorizationKind;
  method: AuthorizationMethod;
  note?: string | null;
}

export function authorizationHost(targetUrl: string): { targetUrl: string; host: string } {
  const url = new URL(targetUrl);
  return { targetUrl: url.origin, host: url.host.toLowerCase() };
}

export async function recordScanAuthorization(input: AuthorizationInput): Promise<void> {
  const target = authorizationHost(input.targetUrl);
  const email = input.userEmail.trim();
  if (!email) throw new Error("authorization record needs an account email");
  await prisma.scanAuthorization.create({
    data: {
      userId: input.userId,
      userEmail: email,
      projectId: input.projectId ?? null,
      scanId: input.scanId ?? null,
      targetUrl: target.targetUrl,
      host: target.host,
      kind: input.kind,
      method: input.method,
      note: input.note ? input.note.slice(0, 500) : null,
    },
  });
}

export interface AbuseAuthorizationRow {
  id: string;
  userId: string;
  userEmail: string;
  projectId: string | null;
  scanId: string | null;
  targetUrl: string;
  host: string;
  kind: string;
  method: string;
  note: string | null;
  createdAt: string;
}

export interface AbuseScanRow {
  id: string;
  userId: string;
  userEmail: string;
  projectId: string;
  targetUrl: string;
  status: string;
  consentAt: string | null;
  consentText: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface AbuseProjectRow {
  id: string;
  userId: string;
  userEmail: string;
  targetUrl: string;
  host: string;
  ownershipMethod: string | null;
  ownershipVerifiedAt: string | null;
  createdAt: string;
}

export interface AbuseExport {
  host: string;
  exportedAt: string;
  authorizations: AbuseAuthorizationRow[];
  scans: AbuseScanRow[];
  projects: AbuseProjectRow[];
}

export function hostsMatch(recordHost: string, queryHost: string): boolean {
  const left = recordHost.toLowerCase();
  const right = queryHost.toLowerCase();
  if (left === right) return true;
  try {
    return new URL(`http://${left}`).hostname === new URL(`http://${right}`).hostname;
  } catch {
    return false;
  }
}

export function parseAbuseHost(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    throw new Error("Pass the host from the abuse report, such as example.com");
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error("Pass the host from the abuse report, such as example.com");
  }
  if (!url.hostname || url.username || url.password) {
    throw new Error("Pass the host from the abuse report, such as example.com");
  }
  if (!url.hostname.includes(".") && url.hostname !== "localhost") {
    throw new Error("Pass the host from the abuse report, such as example.com");
  }
  return url.host.toLowerCase();
}

/** Drops anything that is not part of an abuse reply, including ownership tokens. */
export function shapeAbuseExport(input: {
  host: string;
  exportedAt: string;
  authorizations: AbuseAuthorizationRow[];
  scans: AbuseScanRow[];
  projects: AbuseProjectRow[];
}): AbuseExport {
  const host = input.host.toLowerCase();
  const pick = <T extends { host?: string; targetUrl?: string }>(rows: T[]): T[] =>
    rows.filter((row) => {
      if (row.host && hostsMatch(row.host, host)) return true;
      if (row.targetUrl) {
        try {
          return hostsMatch(new URL(row.targetUrl).host, host);
        } catch {
          return false;
        }
      }
      return false;
    });
  return {
    host,
    exportedAt: input.exportedAt,
    authorizations: pick(input.authorizations).map((row) => ({
      id: row.id,
      userId: row.userId,
      userEmail: row.userEmail,
      projectId: row.projectId,
      scanId: row.scanId,
      targetUrl: row.targetUrl,
      host: row.host,
      kind: row.kind,
      method: row.method,
      note: row.note,
      createdAt: row.createdAt,
    })),
    scans: pick(input.scans).map((row) => ({
      id: row.id,
      userId: row.userId,
      userEmail: row.userEmail,
      projectId: row.projectId,
      targetUrl: row.targetUrl,
      status: row.status,
      consentAt: row.consentAt,
      consentText: row.consentText,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
    })),
    projects: pick(input.projects).map((row) => ({
      id: row.id,
      userId: row.userId,
      userEmail: row.userEmail,
      targetUrl: row.targetUrl,
      host: row.host,
      ownershipMethod: row.ownershipMethod,
      ownershipVerifiedAt: row.ownershipVerifiedAt,
      createdAt: row.createdAt,
    })),
  };
}
