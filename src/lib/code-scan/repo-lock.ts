export interface RepoLinkFields {
  status: string;
  owner: string;
  name: string;
  defaultBranch: string;
  installationId: string;
  repoId: string;
}

export interface LockedCodeRepo {
  status: "connected";
  owner: string;
  name: string;
  defaultBranch: string;
  installationId: string;
}

export function codeScanRepoName(owner: string | null | undefined, name: string | null | undefined): string | null {
  if (!owner || !name) return null;
  return `${owner}/${name}`;
}

/** Fields copied onto a scan when the customer confirms a repository. */
export function repoSnapshotData(link: Pick<RepoLinkFields, "owner" | "name" | "defaultBranch" | "installationId" | "repoId"> | null | undefined): {
  codeRepoOwner: string;
  codeRepoName: string;
  codeRepoBranch: string;
  codeRepoInstallationId: string;
  codeRepoId: string;
} | Record<string, never> {
  if (!link?.owner || !link.name || !link.installationId) return {};
  return {
    codeRepoOwner: link.owner,
    codeRepoName: link.name,
    codeRepoBranch: link.defaultBranch || "main",
    codeRepoInstallationId: link.installationId,
    codeRepoId: link.repoId || "",
  };
}

/**
 * The repository this scan is allowed to read.
 * A confirmed snapshot wins over a later change on the project.
 * A skip choice reads no repository.
 */
export function repoForCodeScan(scan: {
  codeScanChoice?: string | null;
  codeRepoOwner?: string | null;
  codeRepoName?: string | null;
  codeRepoBranch?: string | null;
  codeRepoInstallationId?: string | null;
  project?: { repoLink: RepoLinkFields | null } | null;
}): LockedCodeRepo | null {
  if (scan.codeScanChoice === "skip") return null;
  if (scan.codeRepoOwner && scan.codeRepoName && scan.codeRepoInstallationId) {
    return {
      status: "connected",
      owner: scan.codeRepoOwner,
      name: scan.codeRepoName,
      defaultBranch: scan.codeRepoBranch || "main",
      installationId: scan.codeRepoInstallationId,
    };
  }
  const link = scan.project?.repoLink;
  if (link && link.status === "connected" && link.owner && link.name && link.installationId) {
    return {
      status: "connected",
      owner: link.owner,
      name: link.name,
      defaultBranch: link.defaultBranch || "main",
      installationId: link.installationId,
    };
  }
  return null;
}
