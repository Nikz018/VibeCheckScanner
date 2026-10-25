import { locateSecretHits } from "../extract";
import { reproduce } from "@/lib/finding-detail";
import type { ProbeResponse } from "@/lib/http";
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
    const envHits: ProbeResponse[] = [];
    const secretHits: Array<{ response: ProbeResponse; hits: ReturnType<typeof locateSecretHits> }> = [];
    for (const path of ENV_PATHS) {
      const response = await ctx.fetch(path, { maxBytes: 100_000 });
      if (!looksLikeEnv(response.status, response.headers["content-type"], response.body)) continue;
      envHits.push(response);
      const hits = locateSecretHits([{ url: response.url, body: response.body }]);
      if (hits.length > 0) secretHits.push({ response, hits });
    }
    ctx.mark("exposed_dotenv");
    if (envHits.length > 0) {
      const first = envHits[0];
      ctx.add(
        "exposed_dotenv",
        "A public path returned an environment file.",
        ctx.detailFor(first, {
          locations: envHits.map((response) => ({ method: "GET", url: response.url })),
          steps: reproduce("GET", first.url, "The body is KEY=value lines from an env file.", "Remove the file from the public host and rotate the values."),
        }),
      );
    }
    ctx.mark("secret_in_public_path");
    if (secretHits.length > 0) {
      const first = secretHits[0];
      const places = secretHits.flatMap((entry) => entry.hits);
      ctx.add(
        "secret_in_public_path",
        "Private credential material was present in a public file. Values were redacted.",
        ctx.detailFor(first.response, {
          locations: places.slice(0, 6).map((hit) => ({
            method: "GET",
            url: hit.url,
            line: hit.line,
            column: hit.column,
            maskedSecret: hit.masked,
          })),
          steps: [
            `Open ${places[0].url} at line ${places[0].line}.`,
            `A credential is present, shown here as ${places[0].masked}.`,
            "Delete the file and rotate the credential.",
          ],
        }),
      );
    }

    const git = await ctx.fetch("/.git/HEAD", { maxBytes: 2000 });
    ctx.mark("exposed_git");
    if (git.status === 200 && git.body.trim().startsWith("ref: refs/")) {
      ctx.add(
        "exposed_git",
        "A git metadata file returned a ref. The repository metadata is public.",
        ctx.detailFor(git, {
          steps: reproduce("GET", git.url, "The body starts with a git ref.", "Stop publishing the .git directory."),
        }),
      );
    }

    const maps: ProbeResponse[] = [];
    for (const script of ctx.scripts) {
      if (!script.url.startsWith("http")) continue;
      if (maps.length >= 6) break;
      const response = await ctx.fetch(`${script.url}.map`, { maxBytes: 200_000 });
      if (response.status === 200 && /"mappings"|"sources"/.test(response.body)) maps.push(response);
    }
    ctx.mark("exposed_sourcemap");
    if (maps.length > 0) {
      ctx.add(
        "exposed_sourcemap",
        "A JavaScript source map was publicly downloadable.",
        ctx.detailFor(maps[0], {
          locations: maps.map((response) => ({ method: "GET", url: response.url })),
          steps: reproduce("GET", maps[0].url, "The body contains source-map mappings.", "Stop publishing maps on the production host."),
        }),
      );
    }

    const debugHits: ProbeResponse[] = [];
    for (const path of DEBUG_PATHS) {
      const response = await ctx.fetch(path, { maxBytes: 50_000 });
      if (response.status === 200 && looksDebug(response.body)) debugHits.push(response);
    }
    ctx.mark("exposed_debug_route");
    if (debugHits.length > 0) {
      ctx.add(
        "exposed_debug_route",
        "Debug output was reachable without a session.",
        ctx.detailFor(debugHits[0], {
          locations: debugHits.map((response) => ({ method: "GET", url: response.url })),
          steps: reproduce("GET", debugHits[0].url, "The body includes debug or environment details.", "Remove the route from production."),
        }),
      );
    }

    const noisy: ProbeResponse[] = [];
    for (const path of ERROR_PATHS) {
      const response = await ctx.fetch(path, { maxBytes: 50_000 });
      if (looksLikeStack(response.body)) noisy.push(response);
    }
    ctx.mark("verbose_errors");
    if (noisy.length > 0) {
      ctx.add(
        "verbose_errors",
        "An error response included a stack trace.",
        ctx.detailFor(noisy[0], {
          locations: noisy.map((response) => ({ method: "GET", url: response.url })),
          steps: reproduce("GET", noisy[0].url, "The body includes a stack trace.", "Return a short error and log the stack on the server."),
        }),
      );
    }

    const manifest = await ctx.fetch("/package.json", { maxBytes: 200_000 });
    ctx.mark("exposed_package_manifest");
    if (manifest.status === 200 && looksLikeManifest(manifest.body)) {
      ctx.packageJson = manifest.body;
      ctx.add(
        "exposed_package_manifest",
        "A public path returned a dependency manifest.",
        ctx.detailFor(manifest, {
          steps: reproduce("GET", manifest.url, "The body is a package manifest.", "Publish the built assets only."),
        }),
      );
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
