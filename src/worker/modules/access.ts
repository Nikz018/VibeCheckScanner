import { reproduce } from "@/lib/finding-detail";
import type { ProbeResponse } from "@/lib/http";
import { locateText } from "../extract";
import { runModule, type ScanContext } from "../context";

export const ACCESS_CHECK_IDS = ["admin_surface_open", "idor_sequential_ids", "client_side_paywall"] as const;

export async function runAccess(ctx: ScanContext): Promise<void> {
  await runModule([...ACCESS_CHECK_IDS], ctx, async () => {
    const adminHits: ProbeResponse[] = [];
    for (const path of ["/admin", "/api/admin", "/api/admin/users"]) {
      const response = await ctx.fetch(path, { maxBytes: 80_000 });
      if (looksPrivileged(response.status, response.body)) adminHits.push(response);
    }
    ctx.mark("admin_surface_open");
    if (adminHits.length > 0) {
      ctx.add(
        "admin_surface_open",
        "An admin page or API returned privileged content with no session cookie.",
        ctx.detailFor(adminHits[0], {
          locations: adminHits.map((response) => ({ method: "GET", url: response.url })),
          steps: reproduce("GET", adminHits[0].url, "The response includes admin data and no session cookie was sent.", "Check the session on the server before returning admin data."),
        }),
      );
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
          "Two sequential ids returned different records with no session cookie. Record contents were not copied into this report.",
          ctx.detailFor(first, {
            locations: [
              { method: "GET", url: first.url },
              { method: "GET", url: second.url },
            ],
            steps: reproduce("GET", first.url, `GET ${second.url} returned a different record. No session cookie was sent.`, "Authorize the object owner on the server."),
          }),
        );
      }
    }

    ctx.mark("client_side_paywall");
    const paywall = locateText(ctx.scripts, /localStorage\.getItem\(\s*["'](plan|isPro|isPremium|subscription)["']\s*\)/);
    if (paywall) {
      const file = ctx.scripts.find((script) => script.url === paywall.url);
      const url = paywall.url.startsWith("inline:") || paywall.url.startsWith("rendered:") ? ctx.home?.url || ctx.targetUrl : paywall.url;
      ctx.add(
        "client_side_paywall",
        "Client code gates premium access with a localStorage flag instead of a server check.",
        ctx.detailFor(
          {
            url,
            status: 200,
            headers: { "content-type": "application/javascript" },
            body: file?.body ?? "",
            setCookies: [],
            location: null,
          },
          {
            locations: [{ method: "GET", url, line: paywall.line, column: paywall.column }],
            steps: [
              `Open ${url} at line ${paywall.line}.`,
              "Premium access is decided from a localStorage flag.",
              "Check the purchase on the server before sending paid data.",
            ],
          },
        ),
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
