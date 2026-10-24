import { runModule, type ScanContext } from "../context";

export const ACCESS_CHECK_IDS = ["admin_surface_open", "idor_sequential_ids", "client_side_paywall"] as const;

export async function runAccess(ctx: ScanContext): Promise<void> {
  await runModule([...ACCESS_CHECK_IDS], ctx, async () => {
    const adminHits: string[] = [];
    for (const path of ["/admin", "/api/admin", "/api/admin/users"]) {
      const response = await ctx.fetch(path, { maxBytes: 80_000 });
      if (looksPrivileged(response.status, response.body)) adminHits.push(path);
    }
    ctx.mark("admin_surface_open");
    if (adminHits.length > 0) {
      ctx.add("admin_surface_open", `These paths returned privileged content with no session cookie: ${adminHits.join(", ")}.`);
    }

    ctx.mark("idor_sequential_ids");
    const first = await ctx.fetch("/api/users/1");
    const second = await ctx.fetch("/api/users/2");
    const left = parseRecord(first.body);
    const right = parseRecord(second.body);
    if (first.status === 200 && second.status === 200 && left && right) {
      const leftId = String(left.id ?? left.email ?? "");
      const rightId = String(right.id ?? right.email ?? "");
      if (leftId && rightId && leftId !== rightId) {
        ctx.add(
          "idor_sequential_ids",
          "GET /api/users/1 and GET /api/users/2 both returned different records with no session cookie. Identifiers were not copied into this report.",
        );
      }
    }

    ctx.mark("client_side_paywall");
    if (/localStorage\.getItem\(\s*["'](plan|isPro|isPremium|subscription)["']\s*\)/.test(ctx.scriptText())) {
      ctx.add(
        "client_side_paywall",
        "Client code gates premium access with a localStorage flag (plan, isPro, isPremium, or subscription) instead of a server check.",
      );
    }
  });
}

function looksPrivileged(status: number, body: string): boolean {
  if (status !== 200) return false;
  if (/type=["']password["']/i.test(body)) return false;
  if (body.includes("data-admin-panel")) return true;
  const parsed = parseJson(body);
  if (Array.isArray(parsed) && parsed.some((row) => row && typeof row === "object" && ("email" in row || "role" in row))) return true;
  return false;
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function parseRecord(body: string): Record<string, unknown> | null {
  const parsed = parseJson(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}
