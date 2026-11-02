import path from "node:path";
import { scanRepoDirectory } from "@/lib/code-scan/engine";
import { cloneShallow, withIsolatedDir } from "@/lib/code-scan/clone";
import { canRunCodeScan } from "@/lib/code-scan/gate";
import { shellCodeReport } from "@/lib/code-scan/parse";
import type { CodeScanReport } from "@/lib/code-scan/types";
import { githubAppConfig, fetchInstallationToken } from "@/lib/github/app";
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

  const config = githubAppConfig();
  if (!config) return shellCodeReport("failed", ["Repository connection is not available on this server yet."], `${target.repo.owner}/${target.repo.name}`);

  try {
    const token = await fetchInstallationToken({
      appId: config.appId,
      privateKey: config.privateKey,
      installationId: target.repo.installationId,
    });
    const repoName = `${target.repo.owner}/${target.repo.name}`;
    const report = await withIsolatedDir(async (dir) => {
      const dest = path.join(dir, "repo");
      const cloned = await cloneShallow({
        repoUrl: `https://github.com/${repoName}.git`,
        dest,
        branch: target.repo?.defaultBranch || undefined,
        token,
      });
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
    return shellCodeReport("failed", ["The code scan could not finish. The site results are still available."], `${target.repo.owner}/${target.repo.name}`);
  }
}
