import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { SourceFile, SourceLanguage } from "./types";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "vendor", "out", ".turbo"]);
const MAX_FILES = 2500;
const MAX_BYTES = 400_000;

export function languageFor(relativePath: string): SourceLanguage | null {
  const base = path.posix.basename(relativePath.replace(/\\/g, "/"));
  if (/\.(jsx?|tsx?|mjs|cjs)$/.test(base)) return "javascript";
  if (/\.py$/.test(base)) return "python";
  return null;
}

export function classifyFile(relativePath: string): SourceFile["kind"] | null {
  const normalized = relativePath.replace(/\\/g, "/");
  const base = path.posix.basename(normalized);
  if (base === ".env.example" || base === ".env.sample" || base === ".env.template") return "text";
  if (base === ".env" || base.startsWith(".env.")) return "env";
  if (base.endsWith(".sql")) return "sql";
  if (base.endsWith(".rules") || base === "database.rules.json" || base === "firestore.rules" || base === "storage.rules") return "firebase";
  if (base === "package.json") return "manifest";
  if (base === "package-lock.json" || base === "npm-shrinkwrap.json" || base === "yarn.lock" || base === "pnpm-lock.yaml") return "lock";
  if (/^next\.config\./.test(base) || /^middleware\./.test(base)) return "config";
  if (languageFor(normalized) === "javascript") return "javascript";
  if (languageFor(normalized) === "python") return "python";
  if (base.endsWith(".json") || base.endsWith(".yaml") || base.endsWith(".yml")) return "text";
  return null;
}

function shouldRead(relativePath: string): boolean {
  return classifyFile(relativePath) !== null;
}

export async function walkRepo(root: string): Promise<{ files: SourceFile[]; truncated: boolean }> {
  const files: SourceFile[] = [];
  let truncated = false;

  async function visit(directory: string): Promise<void> {
    if (truncated) return;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      if (entry.name.startsWith(".git")) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = path.relative(root, absolute).replace(/\\/g, "/");
      if (!shouldRead(relativePath)) continue;
      const info = await stat(absolute);
      if (info.size > MAX_BYTES) continue;
      const buffer = await readFile(absolute);
      if (buffer.includes(0)) continue;
      const kind = classifyFile(relativePath);
      if (!kind) continue;
      files.push({
        relativePath,
        kind,
        language: languageFor(relativePath),
        text: buffer.toString("utf8"),
      });
    }
  }

  await visit(root);
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return { files, truncated };
}
