import { findSecretKinds } from "../extract";
import { runModule, type ScanContext } from "../context";

export const EXPOSURE_CHECK_IDS = [
  "secret_in_public_path",
  "exposed_dotenv",
  "exposed_git",
  "exposed_sourcemap",
  "exposed_debug_route",
  "verbose_errors",
  "exposed_package_manifest",
] as const;

const ENV_PATHS = ["/.env", "/.env.local", "/.env.production"];
const DEBUG_PATHS = ["/debug", "/api/debug", "/test"];
const ERROR_PATHS = ["/api/error", "/api/vibecheck-missing-route"];

export async function runExposure(ctx: ScanContext): Promise<void> {
  await runModule([...EXPOSURE_CHECK_IDS], ctx, async () => {
    const secretPaths: string[] = [];
    const envHits: string[] = [];
    for (const path of ENV_PATHS) {
      const response = await ctx.fetch(path, { maxBytes: 100_000 });
      if (!looksLikeEnv(response.status, response.headers["content-type"], response.body)) continue;
      envHits.push(path);
      if (findSecretKinds(response.body).length > 0) secretPaths.push(path);
    }
    ctx.mark("exposed_dotenv");
    if (envHits.length > 0) ctx.add("exposed_dotenv", `These paths returned environment files: ${envHits.join(", ")}.`);
    ctx.mark("secret_in_public_path");
    if (secretPaths.length > 0) {
      ctx.add("secret_in_public_path", `Private credential material was present in ${secretPaths.join(", ")}. Values were redacted.`);
    }

    const git = await ctx.fetch("/.git/HEAD", { maxBytes: 2000 });
    ctx.mark("exposed_git");
    if (git.status === 200 && git.body.trim().startsWith("ref: refs/")) {
      ctx.add("exposed_git", "GET /.git/HEAD returned a git ref. The repository metadata is public.");
    }

    const maps: string[] = [];
    for (const script of ctx.scripts) {
      if (!script.url.startsWith("http")) continue;
      if (maps.length >= 6) break;
      const response = await ctx.fetch(`${script.url}.map`, { maxBytes: 200_000 });
      if (response.status === 200 && /"mappings"|"sources"/.test(response.body)) maps.push(`${script.url}.map`);
    }
    ctx.mark("exposed_sourcemap");
    if (maps.length > 0) ctx.add("exposed_sourcemap", `Source maps were public at ${maps.join(", ")}.`);

    const debugHits: string[] = [];
    for (const path of DEBUG_PATHS) {
      const response = await ctx.fetch(path, { maxBytes: 50_000 });
      if (response.status === 200 && looksDebug(response.body)) debugHits.push(path);
    }
    ctx.mark("exposed_debug_route");
    if (debugHits.length > 0) ctx.add("exposed_debug_route", `Debug output was reachable at ${debugHits.join(", ")}.`);

    const noisy: string[] = [];
    for (const path of ERROR_PATHS) {
      const response = await ctx.fetch(path, { maxBytes: 50_000 });
      if (looksLikeStack(response.body)) noisy.push(path);
    }
    ctx.mark("verbose_errors");
    if (noisy.length > 0) ctx.add("verbose_errors", `A stack trace was returned by ${noisy.join(", ")}.`);

    const manifest = await ctx.fetch("/package.json", { maxBytes: 200_000 });
    ctx.mark("exposed_package_manifest");
    if (manifest.status === 200 && looksLikeManifest(manifest.body)) {
      ctx.packageJson = manifest.body;
      ctx.add("exposed_package_manifest", "GET /package.json returned a dependency manifest.");
    }
  });
}

function looksLikeEnv(status: number, contentType: string | undefined, body: string): boolean {
  if (status !== 200) return false;
  if ((contentType || "").includes("text/html")) return false;
  if (/<html/i.test(body.slice(0, 200))) return false;
  return /^[A-Z0-9_]+=.+$/m.test(body);
}

function looksDebug(body: string): boolean {
  return /debug route/i.test(body) || /NODE_ENV/.test(body) || /process\.env/.test(body);
}

function looksLikeStack(body: string): boolean {
  return /node_modules\//.test(body) || /\n\s+at .+ \(/.test(body) || /at\s+\S+\s+\(\/app\//.test(body);
}

function looksLikeManifest(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as { dependencies?: unknown; name?: unknown };
    return Boolean(parsed && (parsed.dependencies || parsed.name));
  } catch {
    return false;
  }
}
