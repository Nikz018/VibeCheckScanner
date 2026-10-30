import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { countNewMonitorIssues } from "./monitor-alerts";

test("a new high CVE on a known library counts, and a repeated CVE does not", () => {
  const previous = [
    {
      checkId: "vulnerable_dependency",
      severity: "high",
      evidence: "lodash@4.17.15 (CVE-2021-23337: Prototype pollution).",
      raw: { advisories: [{ id: "CVE-2021-23337", severity: "high" }] },
    },
    { checkId: "missing_csp", severity: "medium", evidence: "header missing" },
  ];
  assert.equal(
    countNewMonitorIssues(previous, [
      {
        checkId: "vulnerable_dependency",
        severity: "high",
        advisories: [
          { id: "CVE-2021-23337", severity: "high" },
          { id: "CVE-2020-28500", severity: "medium" },
        ],
      },
    ]),
    0,
  );
  assert.equal(
    countNewMonitorIssues(previous, [
      {
        checkId: "vulnerable_dependency",
        severity: "critical",
        advisories: [
          { id: "CVE-2021-23337", severity: "high" },
          { id: "CVE-2025-99999", severity: "critical" },
        ],
      },
    ]),
    1,
  );
  assert.equal(
    countNewMonitorIssues(previous, [
      {
        checkId: "vulnerable_dependency",
        severity: "high",
        advisories: [
          { id: "GHSA-35jh-r3h4-6jhm", severity: "high" },
          { id: "CVE-2025-11111", severity: "high" },
        ],
      },
      {
        checkId: "vulnerable_dependency",
        severity: "high",
        advisories: [{ id: "cve-2025-11111", severity: "high" }],
      },
    ]),
    2,
  );
});

test("older manifest evidence still suppresses the same CVE id", () => {
  const previous = [
    {
      checkId: "vulnerable_dependency",
      severity: "high",
      evidence: "The public manifest lists lodash@4.17.15 (CVE-2021-23337: Prototype pollution in lodash before 4.17.21).",
    },
  ];
  assert.equal(
    countNewMonitorIssues(previous, [
      {
        checkId: "vulnerable_dependency",
        severity: "high",
        advisories: [{ id: "CVE-2021-23337", severity: "high" }],
      },
    ]),
    0,
  );
});

test("other high-severity checks still alert once, and medium checks do not", () => {
  assert.equal(
    countNewMonitorIssues([{ checkId: "missing_csp", severity: "medium", evidence: "csp" }], [
      { checkId: "exposed_git", severity: "high" },
      { checkId: "missing_referrer_policy", severity: "low" },
    ]),
    1,
  );
  assert.equal(
    countNewMonitorIssues([{ checkId: "exposed_git", severity: "high", evidence: "git" }], [{ checkId: "exposed_git", severity: "high" }]),
    0,
  );
});

test("scheduled scans count new CVEs through the existing alert email", () => {
  const execute = readFileSync(new URL("../worker/execute.ts", import.meta.url), "utf8");
  const alerts = execute.slice(execute.indexOf("async function maybeAlert"));
  assert.match(alerts, /countNewMonitorIssues/);
  assert.match(alerts, /renderMonitorAlertEmail/);
  assert.doesNotMatch(alerts, /finding\.(title|evidence|impact|fix|locations|proof)/);
});
