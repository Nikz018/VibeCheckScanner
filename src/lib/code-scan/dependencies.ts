import type { AdvisoryHit, AdvisoryLookupFn, PackageVersion } from "@/lib/osv";
import { packageAdvisoryKey } from "@/lib/osv";
import type { SourceFile } from "./types";

const MAX_PACKAGES = 40;

const ABANDONED = new Set([
  "request",
  "request-promise",
  "request-promise-native",
  "gulp-util",
  "nomnom",
  "node-uuid",
  "jade",
  "constantinople",
  "hawk",
]);

/** Names people mistype. Real neighbors that are one edit away stay off the list. */
const POPULAR = [
  "react",
  "react-dom",
  "next",
  "express",
  "lodash",
  "axios",
  "firebase",
  "mongoose",
  "jsonwebtoken",
  "stripe",
  "openai",
  "typescript",
  "webpack",
  "vite",
  "eslint",
  "prettier",
];

const ALLOW = new Set([
  ...POPULAR,
  "nest",
  "preact",
  "vue",
  "koa",
  "hono",
  "fastify",
  "got",
  "undici",
  "zod",
  "ws",
  "pg",
  "redis",
  "supabase",
]);

export interface DependencyFacts {
  names: string[];
  locked: PackageVersion[];
  truncated: boolean;
  hasManifest: boolean;
  hasLockfile: boolean;
}

export function parseDependencies(files: SourceFile[]): DependencyFacts {
  const names = new Set<string>();
  const locked = new Map<string, PackageVersion>();
  let hasManifest = false;
  let hasLockfile = false;
  for (const file of files) {
    if (file.kind === "manifest") {
      hasManifest = true;
      for (const name of packageJsonNames(file.text)) names.add(name);
    }
    if (file.kind === "lock") {
      hasLockfile = true;
      for (const item of lockfilePackages(file)) {
        names.add(item.name);
        locked.set(packageAdvisoryKey(item.name, item.version), item);
      }
    }
  }
  const allLocked = [...locked.values()].sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
  return {
    names: [...names].sort(),
    locked: allLocked.slice(0, MAX_PACKAGES),
    truncated: allLocked.length > MAX_PACKAGES,
    hasManifest,
    hasLockfile,
  };
}

export async function lookupLocked(
  locked: PackageVersion[],
  lookup: AdvisoryLookupFn,
): Promise<Map<string, AdvisoryHit[]>> {
  if (locked.length === 0) return new Map();
  const result = await lookup(locked);
  return result.byPackage;
}

function packageJsonNames(text: string): string[] {
  try {
    const parsed = JSON.parse(text) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    return Object.keys({
      ...(parsed.dependencies ?? {}),
      ...(parsed.devDependencies ?? {}),
      ...(parsed.optionalDependencies ?? {}),
    });
  } catch {
    return [];
  }
}

function lockfilePackages(file: SourceFile): PackageVersion[] {
  const base = file.relativePath.split("/").pop() ?? "";
  if (base === "package-lock.json" || base === "npm-shrinkwrap.json") return npmLock(file.text);
  if (base === "yarn.lock") return yarnLock(file.text);
  if (base === "pnpm-lock.yaml") return pnpmLock(file.text);
  return [];
}

function npmLock(text: string): PackageVersion[] {
  try {
    const parsed = JSON.parse(text) as {
      packages?: Record<string, { version?: string }>;
      dependencies?: Record<string, { version?: string; dependencies?: Record<string, { version?: string }> }>;
    };
    const found: PackageVersion[] = [];
    if (parsed.packages) {
      for (const [key, value] of Object.entries(parsed.packages)) {
        if (!key || !value?.version) continue;
        const name = nameFromNodeModules(key);
        if (name) found.push({ name, version: value.version });
      }
    }
    if (found.length === 0 && parsed.dependencies) collectNpmV1(parsed.dependencies, found);
    return found;
  } catch {
    return [];
  }
}

function collectNpmV1(tree: Record<string, { version?: string; dependencies?: Record<string, { version?: string }> }>, found: PackageVersion[]): void {
  for (const [name, value] of Object.entries(tree)) {
    if (value.version) found.push({ name, version: value.version });
    if (value.dependencies) collectNpmV1(value.dependencies, found);
  }
}

function nameFromNodeModules(key: string): string | null {
  const parts = key.split("node_modules/");
  const name = parts[parts.length - 1];
  if (!name || name === key) return null;
  return name;
}

function yarnLock(text: string): PackageVersion[] {
  const found: PackageVersion[] = [];
  let current: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line && !line.startsWith(" ") && line.endsWith(":")) {
      current = line
        .slice(0, -1)
        .split(",")
        .map((part) => part.trim().replace(/^"|"$/g, ""))
        .map((part) => part.split("@").slice(0, part.startsWith("@") ? 2 : 1).join("@"));
      continue;
    }
    const version = line.match(/^\s+version\s+"([^"]+)"/);
    if (!version) continue;
    for (const name of current) {
      if (name) found.push({ name, version: version[1] });
    }
  }
  return found;
}

function pnpmLock(text: string): PackageVersion[] {
  const found: PackageVersion[] = [];
  for (const match of text.matchAll(/^\s{2}['"]?(@?[^@\s'"]+)@(\d+\.\d+\.\d+[^:'"]*)['"]?:/gm)) {
    found.push({ name: match[1], version: match[2] });
  }
  return found;
}

export function abandonedPackages(names: string[]): string[] {
  return names.filter((name) => ABANDONED.has(unscoped(name))).sort();
}

export function typosquatPackages(names: string[]): Array<{ name: string; looksLike: string }> {
  const hits: Array<{ name: string; looksLike: string }> = [];
  for (const name of names) {
    const base = unscoped(name);
    const popular = looksLikeTyposquat(base);
    if (popular) hits.push({ name, looksLike: popular });
  }
  return hits.sort((left, right) => left.name.localeCompare(right.name));
}

function unscoped(name: string): string {
  if (name.startsWith("@types/")) return name.slice("@types/".length);
  const slash = name.lastIndexOf("/");
  return slash >= 0 ? name.slice(slash + 1) : name;
}

export function looksLikeTyposquat(name: string): string | null {
  if (ALLOW.has(name) || name.length < 4) return null;
  for (const popular of POPULAR) {
    if (Math.abs(popular.length - name.length) > 1) continue;
    if (popular[0] !== name[0]) continue;
    if (damerau(popular, name) === 1) return popular;
  }
  return null;
}

function damerau(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let row = 0; row < rows; row += 1) matrix[row][0] = row;
  for (let col = 0; col < cols; col += 1) matrix[0][col] = col;
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(matrix[row - 1][col] + 1, matrix[row][col - 1] + 1, matrix[row - 1][col - 1] + cost);
      if (row > 1 && col > 1 && left[row - 1] === right[col - 2] && left[row - 2] === right[col - 1]) {
        matrix[row][col] = Math.min(matrix[row][col], matrix[row - 2][col - 2] + 1);
      }
    }
  }
  return matrix[left.length][right.length];
}
