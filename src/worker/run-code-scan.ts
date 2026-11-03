import path from "node:path";
import { scanRepoDirectory } from "@/lib/code-scan/engine";
import { cloneShallow, verifyGitAvailable, withIsolatedDir } from "@/lib/code-scan/clone";
import { canRunCodeScan } from "@/lib/code-scan/gate";
import { CODE_SCAN_EMPTY_NOTICE, CODE_SCAN_FAILED_NOTICE } from "@/lib/code-scan/messages";
import { shellCodeReport } from "@/lib/code-scan/parse";
import type { CodeScanReport } from "@/lib/code-scan/types";
import { githubAppConfig, confirmRepositoryReadable, createRepoReadToken } from "@/lib/github/app";
import { explainCodeFindings } from "./modules/llm";

export interface CodeScanTarget {
  ownershipVerified: boolean;
  codeScanEnabled: boolean;
  repo: {
    status: string;
    owner: string;
    name: string;
    defaultBranch: string;
    installationId: string;
  } | null;
}

export async function runProjectCodeScan(target: CodeScanTarget): Promise<CodeScanReport> {
  const connected = Boolean(target.repo && target.repo.status === "connected" && target.repo.owner && target.repo.name);
  const gate = canRunCodeScan({
    ownershipVerified: target.ownershipVerified,
    codeScanEnabled: target.codeScanEnabled,
    repoConnected: connected,
  });
  if (!target.codeScanEnabled) return shellCodeReport("skipped", [gate.ok ? "Code scan is not included on this plan." : gate.reason]);
  if (!target.ownershipVerified) return shellCodeReport("failed", [gate.ok ? "Ownership was not verified." : gate.reason]);
  if (!connected || !target.repo) return shellCodeReport("not_connected", ["Connect one repository to run the code scan. The site results are already saved."]);

  const repoName = `${target.repo.owner}/${target.repo.name}`;
  const git = verifyGitAvailable();
  if (!git.ok) {
    console.error("code scan git missing", git.error);
    return shellCodeReport("failed", [CODE_SCAN_FAILED_NOTICE], repoName);
  }

  const config = githubAppConfig();
  if (!config) return shellCodeReport("failed", ["Repository connection is not available on this server yet."], repoName);

  try {
    const owner = target.repo.owner;
    const name = target.repo.name;
    const minted = await createRepoReadToken({
      appId: config.appId,
      privateKey: config.privateKey,
      installationId: target.repo.installationId,
      repoName: name,
    });
    if (!minted.ok) return shellCodeReport("failed", [minted.reason], repoName);
    const readable = await confirmRepositoryReadable({ token: minted.token, owner, name });
    if (!readable.ok) return shellCodeReport("failed", [readable.reason], repoName);
    const token = minted.token;
    const report = await withIsolatedDir(async (dir) => {
      const dest = path.join(dir, "repo");
      const cloned = await cloneShallow({
        repoUrl: `https://github.com/${repoName}.git`,
        dest,
        branch: target.repo?.defaultBranch || undefined,
        token,
        resolveDefaultBranch: async () => readable.defaultBranch,
      });
      if (cloned.empty) {
        const empty = shellCodeReport("completed", [CODE_SCAN_EMPTY_NOTICE], repoName);
        empty.empty = true;
        return empty;
      }
      const scanned = await scanRepoDirectory(dest);
      scanned.repo = repoName;
      scanned.commit = cloned.commit;
      try {
        scanned.findings = await explainCodeFindings(scanned.findings);
      } catch (error) {
        console.error("code scan explanation failed", error instanceof Error ? error.message : "error");
      }
      return scanned;
    });
    return report;
  } catch (error) {
    console.error("code scan failed", error instanceof Error ? error.message : "error");
    return shellCodeReport("failed", [CODE_SCAN_FAILED_NOTICE], repoName);
  }
}
