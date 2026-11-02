import { OWASP_TOP_10, type OwaspId, type OwaspRow, type OwaspStatus } from "./types";

export function owaspStatusLabel(status: OwaspStatus): string {
  if (status === "issues_found") return "issues found";
  if (status === "not_checked") return "not checked";
  return "passed";
}

export function emptyOwasp(): OwaspRow[] {
  return OWASP_TOP_10.map((category) => ({
    id: category.id,
    name: category.name,
    status: "not_checked" as const,
    findingCount: 0,
  }));
}

export function buildOwasp(checked: ReadonlySet<OwaspId>, counts: ReadonlyMap<OwaspId, number>): OwaspRow[] {
  return OWASP_TOP_10.map((category) => {
    const findingCount = counts.get(category.id) ?? 0;
    let status: OwaspStatus = "not_checked";
    if (findingCount > 0) status = "issues_found";
    else if (checked.has(category.id)) status = "passed";
    return { id: category.id, name: category.name, status, findingCount };
  });
}
