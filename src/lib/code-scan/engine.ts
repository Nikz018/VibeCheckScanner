import type { AdvisoryLookupFn } from "@/lib/osv";
import { lookupAdvisories } from "@/lib/osv";
import { parseDependencies, lookupLocked } from "./dependencies";
import { walkRepo } from "./files";
import { readRecentHistory } from "./history";
import { buildOwasp } from "./owasp";
import { CODE_PRIVACY_PROMISE, OWASP_ALIGNMENT } from "./privacy";
import { RULES, scopeActive, type RepoFacts } from "./rules";
import type { CodeFinding, CodeScanReport, OwaspId } from "./types";

const MAX_FINDINGS = 80;

export interface ScanRepoOptions {
  lookup?: AdvisoryLookupFn;
}

export async function scanRepoDirectory(root: string, options: ScanRepoOptions = {}): Promise<CodeScanReport> {
  const walked = await walkRepo(root);
  const dependencies = parseDependencies(walked.files);
  const history = await readRecentHistory(root);
  const lookup = options.lookup ?? lookupAdvisories;
  const advisories = await lookupLocked(dependencies.locked, lookup);
  const repo: RepoFacts = {
    files: walked.files,
    javascript: walked.files.filter((file) => file.language === "javascript" || file.kind === "javascript" || file.kind === "config"),
    sql: walked.files.filter((file) => file.kind === "sql"),
    firebase: walked.files.filter((file) => file.kind === "firebase"),
    history: history.hits,
    packageNames: dependencies.names,
    locked: dependencies.locked,
    advisories,
    hasManifest: dependencies.hasManifest,
    hasLockfile: dependencies.hasLockfile,
  };

  const checked = new Set<OwaspId>();
  const findings: CodeFinding[] = [];
  for (const rule of RULES) {
    if (!scopeActive(rule.scope, repo)) continue;
    for (const category of rule.owasp) checked.add(category);
    findings.push(...rule.run(repo));
  }

  const unique = dedupe(findings).slice(0, MAX_FINDINGS);
  const counts = new Map<OwaspId, number>();
  for (const finding of unique) counts.set(finding.owasp, (counts.get(finding.owasp) ?? 0) + 1);

  const notices: string[] = [];
  if (walked.truncated) notices.push("The repository has more files than this scan reads. Later files were not checked.");
  if (dependencies.truncated) notices.push("Dependency checks used the first 40 exact versions in the lockfile.");
  if (!dependencies.hasLockfile && dependencies.hasManifest) {
    notices.push("No lockfile was found, so published vulnerabilities for exact versions were not checked. Package names were still reviewed.");
  }
  if (history.notice) notices.push(history.notice);

  return {
    status: "completed",
    privacy: CODE_PRIVACY_PROMISE,
    repo: null,
    commit: null,
    filesScanned: walked.files.length,
    findings: unique,
    owasp: buildOwasp(checked, counts),
    notices,
    owaspNote: OWASP_ALIGNMENT,
  };
}

function dedupe(findings: CodeFinding[]): CodeFinding[] {
  const seen = new Set<string>();
  const unique: CodeFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.ruleId}:${finding.file}:${finding.line}:${finding.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(finding);
  }
  return unique;
}
