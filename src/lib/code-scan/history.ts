import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { HistoryHit } from "./types";

const exec = promisify(execFile);
const HISTORY_COMMITS = 20;
const MAX_HITS = 30;

export async function readRecentHistory(root: string): Promise<{ hits: HistoryHit[]; notice: string | null }> {
  if (!existsSync(path.join(root, ".git"))) return { hits: [], notice: null };
  try {
    const { stdout } = await exec(
      "git",
      ["-C", root, "log", "-n", String(HISTORY_COMMITS), "-p", "--pretty=format:COMMIT:%H", "--unified=0"],
      {
        timeout: 20_000,
        maxBuffer: 2_000_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
    );
    return { hits: parseHistory(stdout).slice(0, MAX_HITS), notice: null };
  } catch {
    return { hits: [], notice: "Recent commit history could not be read. Checks on the current files still ran." };
  }
}

export function parseHistory(diff: string): HistoryHit[] {
  const hits: HistoryHit[] = [];
  let commit = "";
  let filePath = "";
  const seenEnv = new Set<string>();
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("COMMIT:")) {
      commit = line.slice("COMMIT:".length).trim();
      filePath = "";
      continue;
    }
    if (line.startsWith("+++ b/")) {
      filePath = line.slice("+++ b/".length).trim();
      if (isEnvPath(filePath) && commit && !seenEnv.has(`${commit}:${filePath}`)) {
        seenEnv.add(`${commit}:${filePath}`);
        hits.push({ commit, path: filePath, lineText: "env file committed" });
      }
      continue;
    }
    if (!commit || !filePath || filePath === "/dev/null") continue;
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    const lineText = line.slice(1);
    if (!lineText.trim()) continue;
    hits.push({ commit, path: filePath, lineText });
  }
  return hits;
}

function isEnvPath(filePath: string): boolean {
  const base = filePath.split("/").pop() ?? "";
  if (base === ".env.example" || base === ".env.sample" || base === ".env.template") return false;
  return base === ".env" || base.startsWith(".env.");
}
