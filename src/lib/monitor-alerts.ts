const SERIOUS = new Set(["critical", "high"]);
const ID_PATTERN = /CVE-\d{4}-\d{4,}|GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/gi;

export interface MonitorAdvisory {
  id: string;
  severity: string;
}

export interface MonitorCurrent {
  checkId: string;
  severity: string;
  advisories?: MonitorAdvisory[];
}

export interface MonitorPrevious {
  checkId: string;
  severity: string;
  evidence?: string;
  raw?: unknown;
}

/** New critical or high issues since the previous completed scan. Dependency CVEs count even when the check id already existed. */
export function countNewMonitorIssues(previous: MonitorPrevious[], current: MonitorCurrent[]): number {
  const previousIds = new Set<string>();
  const previousSerious = new Set<string>();
  for (const finding of previous) {
    if (SERIOUS.has(finding.severity)) previousSerious.add(finding.checkId);
    for (const id of idsFromPrevious(finding)) previousIds.add(id);
  }

  const seenIds = new Set<string>();
  const seenChecks = new Set<string>();
  let count = 0;
  for (const result of current) {
    const advisories = result.advisories ?? [];
    if (advisories.length > 0) {
      for (const advisory of advisories) {
        if (!SERIOUS.has(advisory.severity)) continue;
        const id = advisory.id.toUpperCase();
        if (!id || previousIds.has(id) || seenIds.has(id)) continue;
        seenIds.add(id);
        count += 1;
      }
      continue;
    }
    if (!SERIOUS.has(result.severity) || seenChecks.has(result.checkId) || previousSerious.has(result.checkId)) continue;
    seenChecks.add(result.checkId);
    count += 1;
  }
  return count;
}

function idsFromPrevious(finding: MonitorPrevious): string[] {
  const ids = new Set<string>();
  const raw = finding.raw;
  if (raw && typeof raw === "object" && "advisories" in raw) {
    const advisories = (raw as { advisories?: unknown }).advisories;
    if (Array.isArray(advisories)) {
      for (const item of advisories) {
        if (!item || typeof item !== "object" || !("id" in item)) continue;
        const id = (item as { id?: unknown }).id;
        if (typeof id === "string" && id.trim()) ids.add(id.toUpperCase());
      }
    }
  }
  if (ids.size > 0) return [...ids];
  if (finding.checkId !== "vulnerable_dependency") return [];
  for (const match of finding.evidence?.match(ID_PATTERN) ?? []) ids.add(match.toUpperCase());
  return [...ids];
}
