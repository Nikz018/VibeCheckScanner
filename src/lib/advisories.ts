export interface Advisory {
  name: string;
  below: string;
  cve: string;
  summary: string;
}

/** A small built-in list. Customer text cites the CVE, not a vendor database. */
export const ADVISORIES: Advisory[] = [
  {
    name: "lodash",
    below: "4.17.21",
    cve: "CVE-2021-23337",
    summary: "Prototype pollution in lodash before 4.17.21",
  },
  {
    name: "minimist",
    below: "1.2.6",
    cve: "CVE-2021-44906",
    summary: "Prototype pollution in minimist before 1.2.6",
  },
  {
    name: "jsonwebtoken",
    below: "9.0.0",
    cve: "CVE-2022-23529",
    summary: "jsonwebtoken before 9.0.0 accepts insecure key material",
  },
  {
    name: "semver",
    below: "7.5.2",
    cve: "CVE-2022-25883",
    summary: "Regular expression denial of service in semver before 7.5.2",
  },
  {
    name: "axios",
    below: "1.6.0",
    cve: "CVE-2023-45857",
    summary: "axios before 1.6.0 can leak the XSRF token to a foreign host",
  },
];

export function compareVersions(left: string, right: string): number {
  const parse = (value: string) =>
    value
      .replace(/^v/i, "")
      .split(/[^0-9]+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10));
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < 3; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

export function matchAdvisories(dependencies: Record<string, string>): Array<Advisory & { version: string }> {
  const hits: Array<Advisory & { version: string }> = [];
  for (const [name, raw] of Object.entries(dependencies)) {
    const version = raw.replace(/^[^0-9]*/, "");
    if (!version) continue;
    for (const advisory of ADVISORIES) {
      if (advisory.name === name && compareVersions(version, advisory.below) < 0) {
        hits.push({ ...advisory, version });
      }
    }
  }
  return hits;
}
