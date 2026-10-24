import { runModule, type ScanContext } from "../context";

export const SUPABASE_CHECK_IDS = ["supabase_rls_disabled"] as const;
export const FIREBASE_CHECK_IDS = ["firebase_rules_open"] as const;
export const STORAGE_CHECK_IDS = ["public_storage_bucket", "directory_listing"] as const;

export async function runSupabase(ctx: ScanContext): Promise<void> {
  await runModule([...SUPABASE_CHECK_IDS], ctx, async () => {
    ctx.mark("supabase_rls_disabled");
    if (!ctx.config.supabaseUrl) return;
    const headers = clientHeaders(ctx.config.supabaseAnonKey);
    const tables = ["users", "profiles", "orders", "todos", "messages"];
    const open: string[] = [];
    let writesAdvertised = false;
    for (const table of tables) {
      const response = await ctx.fetch(`${ctx.config.supabaseUrl}/rest/v1/${table}?select=*&limit=2`, { headers });
      const rows = parseArray(response.body);
      if (response.status === 200 && rows && rows.length > 0) {
        open.push(`${table} (${rows.length} row sample, fields ${Object.keys(rows[0]).slice(0, 6).join(", ")})`);
        const options = await ctx.fetch(`${ctx.config.supabaseUrl}/rest/v1/${table}`, { method: "OPTIONS", headers });
        const allow = options.headers.allow || options.headers["access-control-allow-methods"] || "";
        if (/\bPOST\b|\bPATCH\b|\bDELETE\b/i.test(allow)) writesAdvertised = true;
      }
    }
    if (open.length > 0) {
      const writeNote = writesAdvertised ? " Write methods are advertised for at least one of these tables." : "";
      ctx.add("supabase_rls_disabled", `The public client key could read ${open.join("; ")}.${writeNote}`);
    }
  });
}

export async function runFirebase(ctx: ScanContext): Promise<void> {
  await runModule([...FIREBASE_CHECK_IDS], ctx, async () => {
    ctx.mark("firebase_rules_open");
    if (!ctx.config.firebaseDatabaseUrl) return;
    const base = ctx.config.firebaseDatabaseUrl.replace(/\/$/, "");
    const response = await ctx.fetch(`${base}/.json`, { maxBytes: 100_000 });
    if (response.status !== 200) return;
    if (/permission denied/i.test(response.body)) return;
    const parsed = parseObject(response.body);
    if (!parsed) return;
    const keys = Object.keys(parsed).slice(0, 6);
    if (keys.length === 0) return;
    ctx.add("firebase_rules_open", `The database URL returned JSON without a user credential. Top-level keys: ${keys.join(", ")}.`);
  });
}

export async function runStorage(ctx: ScanContext): Promise<void> {
  await runModule([...STORAGE_CHECK_IDS], ctx, async () => {
    ctx.mark("public_storage_bucket");
    if (ctx.config.supabaseUrl) {
      const response = await ctx.fetch(`${ctx.config.supabaseUrl}/storage/v1/bucket`, {
        headers: clientHeaders(ctx.config.supabaseAnonKey),
      });
      const buckets = parseArray(response.body);
      if (response.status === 200 && buckets && buckets.length > 0) {
        const names = buckets
          .map((bucket) => (typeof bucket.name === "string" ? bucket.name : typeof bucket.id === "string" ? bucket.id : "bucket"))
          .slice(0, 5);
        ctx.add("public_storage_bucket", `The storage API listed ${buckets.length} bucket(s): ${names.join(", ")}.`);
      }
    }

    ctx.mark("directory_listing");
    for (const path of ["/uploads/", "/files/", "/storage/"]) {
      const response = await ctx.fetch(path, { maxBytes: 50_000 });
      if (response.status === 200 && /index of|directory listing/i.test(response.body)) {
        ctx.add("directory_listing", `${path} returned a directory listing.`);
        break;
      }
    }
  });
}

function clientHeaders(key: string | null): Record<string, string> {
  if (!key) return { accept: "application/json" };
  return {
    accept: "application/json",
    apikey: key,
    authorization: `Bearer ${key}`,
  };
}

function parseArray(body: string): Array<Record<string, unknown>> | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((row) => row && typeof row === "object") as Array<Record<string, unknown>>;
  } catch {
    return null;
  }
}

function parseObject(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
