import type { Severity } from "./catalog";
import { compareVersions } from "./advisories";
import type { AdvisoryHit } from "./osv";
import type { Confidence } from "./report";
import type { VersionEvidence } from "./fingerprint";

const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const CONFIDENCE_RANK: Record<Confidence, number> = { low: 1, medium: 2, high: 3 };

export interface VulnerableVersion {
  version: string;
  confidence: Confidence;
  evidence: VersionEvidence[];
  advisories: AdvisoryHit[];
}

export interface RenderedDependencyFinding {
  severity: Severity;
  confidence: Confidence;
  title: string;
  evidence: string;
  impact: string;
  fix: string;
  saw: string;
  next: string;
  advisories: Array<{ id: string; severity: Severity }>;
  urls: string[];
  pages: string[];
  primary: VersionEvidence;
}

export function renderDependencyFinding(name: string, versions: VulnerableVersion[]): RenderedDependencyFinding | null {
  const vulnerable = versions.filter((version) => version.advisories.length > 0);
  if (vulnerable.length === 0 || vulnerable.every((version) => version.evidence.length === 0)) return null;
  const advisories = dedupeAdvisories(vulnerable.flatMap((version) => version.advisories));
  if (advisories.length === 0) return null;
  const severity = advisories.reduce<Severity>((highest, hit) => (SEVERITY_RANK[hit.severity] > SEVERITY_RANK[highest] ? hit.severity : highest), "low");
  const confidence = vulnerable.reduce<Confidence>(
    (best, version) => (CONFIDENCE_RANK[version.confidence] > CONFIDENCE_RANK[best] ? version.confidence : best),
    "low",
  );
  const running = [...vulnerable.map((version) => version.version)].sort(compareVersions);
  const highestRunning = running[running.length - 1];
  const fixes = advisories.map((hit) => hit.fixed).filter((fix): fix is string => Boolean(fix));
  const recommended = fixes.filter((fix) => compareVersions(highestRunning, fix) < 0).sort(compareVersions).at(-1) ?? null;
  const primary = [...vulnerable].sort((left, right) => CONFIDENCE_RANK[right.confidence] - CONFIDENCE_RANK[left.confidence])[0].evidence[0];
  const versionLabel = vulnerable.length === 1 ? ` ${vulnerable[0].version}` : "";
  const noun = advisories.length === 1 ? "a published vulnerability" : "published vulnerabilities";
  const shown = advisories.slice(0, 5);
  const listed = shown
    .map((hit) => `${hit.id} (${hit.severity}${hit.fixed ? `, fixed in ${hit.fixed}` : ", no fixed release listed"})`)
    .join("; ");
  const extra = advisories.length > shown.length ? ` and ${advisories.length - shown.length} more` : "";
  const sightings = vulnerable.map((version) => describeVersion(name, version)).join(" ");
  let evidence = `${sightings} The public vulnerability database lists ${listed}${extra}.`;
  if (recommended) evidence += ` Highest listed fix is ${recommended}.`;
  if (evidence.length > 650) evidence = `${evidence.slice(0, 649)}…`;
  const versionList = vulnerable.map((version) => version.version).join(" and ");
  const ids = advisories.slice(0, 6).map((hit) => hit.id).join(", ");
  const fromManifest = vulnerable.some((version) => version.evidence.some((item) => item.source === "package_json"));
  const fixLines = recommended
    ? [`Upgrade ${name} to ${recommended} or later and redeploy.`, "", `npm install ${name}@${recommended}`]
    : [`No fixed release is listed for ${name}. Remove this version or upgrade to a release the public vulnerability database marks as unaffected, then redeploy.`];
  if (fromManifest) {
    fixLines.push("", "Stop publishing package.json. Serve the built assets only.");
  }
  return {
    severity,
    confidence,
    title: `${name}${versionLabel} matches ${noun}`,
    evidence,
    impact: `This site serves ${name} ${versionList}. The public vulnerability database lists ${ids} for ${vulnerable.length === 1 ? "that version" : "those versions"}.`,
    fix: fixLines.join("\n"),
    saw: `The response shows ${name}@${vulnerable[0].version}.`,
    next: recommended ? `Upgrade to ${recommended} or later and redeploy.` : `Upgrade ${name} to a version the public vulnerability database marks as unaffected, then redeploy.`,
    advisories: advisories.slice(0, 30).map((hit) => ({ id: hit.id, severity: hit.severity })),
    urls: locationUrls(vulnerable),
    pages: pageUrls(vulnerable),
    primary,
  };
}

function describeVersion(name: string, version: VulnerableVersion): string {
  const place = version.evidence[0];
  const url = clip(place.url, 180);
  const snippet = clip(place.snippet || `${name}@${version.version}`, 100);
  const more = version.evidence.length > 1 ? ` ${version.evidence.length - 1} more sighting${version.evidence.length === 2 ? "" : "s"}.` : "";
  return `${name}@${version.version} (${version.confidence} confidence) at ${url}. Snippet: ${snippet}.${more}`;
}

function dedupeAdvisories(hits: AdvisoryHit[]): AdvisoryHit[] {
  const byId = new Map<string, AdvisoryHit>();
  for (const hit of hits) {
    const key = hit.id.toUpperCase();
    const existing = byId.get(key);
    if (!existing) {
      byId.set(key, hit);
      continue;
    }
    byId.set(key, {
      id: existing.id,
      summary: existing.summary || hit.summary,
      severity: SEVERITY_RANK[hit.severity] > SEVERITY_RANK[existing.severity] ? hit.severity : existing.severity,
      fixed: existing.fixed ?? hit.fixed,
    });
  }
  return [...byId.values()];
}

function locationUrls(versions: VulnerableVersion[]): string[] {
  const urls: string[] = [];
  const add = (url: string | undefined) => {
    if (!url || !url.startsWith("http") || urls.includes(url)) return;
    urls.push(url);
  };
  for (const version of versions) {
    for (const evidence of version.evidence) {
      add(evidence.url);
      add(evidence.pageUrl);
    }
  }
  return urls.slice(0, 6);
}

function pageUrls(versions: VulnerableVersion[]): string[] {
  const pages: string[] = [];
  for (const version of versions) {
    for (const evidence of version.evidence) {
      const page = evidence.pageUrl;
      if (!page || !page.startsWith("http") || pages.includes(page)) continue;
      pages.push(page);
      if (pages.length >= 25) return pages;
    }
  }
  return pages;
}

function clip(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}
