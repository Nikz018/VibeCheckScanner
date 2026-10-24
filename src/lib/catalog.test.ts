import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { CHECK_CATALOG, FAMILIES, HEADLINE_THEMES, renderChecklistMarkdown } from "./catalog";
import { containsToolBrand } from "./sanitize";

const FAMILY_IDS = [
  "secrets",
  "cloud_backend",
  "access_control",
  "injection_xss",
  "auth_session",
  "transport_headers",
  "info_disclosure",
  "dependencies",
] as const;

test("catalog lists every VibeCheck family", () => {
  assert.deepEqual(
    FAMILIES.map((family) => family.id),
    FAMILY_IDS,
  );
  for (const family of FAMILY_IDS) {
    assert.ok(
      CHECK_CATALOG.some((check) => check.family === family),
      `missing checks for ${family}`,
    );
  }
});

test("every check maps to OWASP, ASVS, and CWE", () => {
  const ids = new Set<string>();
  for (const check of CHECK_CATALOG) {
    assert.equal(ids.has(check.id), false, `duplicate ${check.id}`);
    ids.add(check.id);
    assert.match(check.owaspTop10, /^A\d{2}:2021/);
    assert.match(check.asvs, /^V\d+/);
    assert.match(check.cwe, /^CWE-\d+$/);
    assert.ok(check.title.length > 8);
    assert.ok(check.fix.includes("\n") || check.fix.length > 40);
    assert.equal(containsToolBrand(`${check.title}\n${check.impact}\n${check.fix}`), null, check.id);
  }
});

test("headline ranks 1 through 10 are all present", () => {
  for (const theme of HEADLINE_THEMES) {
    assert.ok(
      CHECK_CATALOG.some((check) => check.headlineRank === theme.rank),
      `missing rank ${theme.rank}`,
    );
  }
  assert.deepEqual(
    HEADLINE_THEMES.map((theme) => theme.rank),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
});

test("security checklist document matches the catalog", () => {
  const file = readFileSync(path.join(process.cwd(), "docs/SECURITY_CHECKLIST.md"), "utf8");
  assert.equal(file, renderChecklistMarkdown());
  for (const family of FAMILY_IDS) assert.ok(file.includes(family));
  for (const check of CHECK_CATALOG) assert.ok(file.includes(check.id), check.id);
});

test("product copy does not make compliance certification claims", () => {
  const roots = ["src", "docs", "demo-targets", "README.md"];
  const banned = /\bSOC\s*2\b|\bHIPAA\b|\bPCI[\s-]?DSS\b|\bPCI\b/i;
  const files: string[] = [];
  const walk = (entry: string) => {
    const full = path.join(process.cwd(), entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry.includes("node_modules")) return;
      for (const child of readdirSync(full)) walk(path.join(entry, child));
      return;
    }
    if (/\.test\.tsx?$/.test(full)) return;
    if (/\.(tsx?|md|css|js)$/.test(full)) files.push(full);
  };
  for (const root of roots) walk(root);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.equal(banned.test(text), false, `${file} contains a compliance claim`);
  }
});
