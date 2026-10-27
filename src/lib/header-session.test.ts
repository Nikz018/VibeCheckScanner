import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { headerAccountActions, headerNavLinks } from "./header-session";

test("signed-out header offers sign in", () => {
  assert.deepEqual(headerAccountActions(false), [{ type: "link", href: "/login", label: "Sign in" }]);
});

test("signed-in header offers dashboard and sign out", () => {
  const actions = headerAccountActions(true);
  assert.equal(
    actions.some((action) => action.type === "link" && action.label === "Sign in"),
    false,
  );
  assert.deepEqual(actions, [
    { type: "link", href: "/dashboard", label: "Dashboard" },
    { type: "sign-out", label: "Sign out" },
  ]);
  const links = headerNavLinks(
    [
      { href: "/pricing", label: "Pricing" },
      { href: "/dashboard", label: "Dashboard" },
    ],
    true,
  );
  assert.deepEqual(links, [{ href: "/pricing", label: "Pricing" }]);
});

test("root layout reads the session on each request", () => {
  const root = process.cwd();
  const layout = readFileSync(path.join(root, "src/app/layout.tsx"), "utf8");
  const header = readFileSync(path.join(root, "src/components/SiteHeader.tsx"), "utf8");
  assert.match(layout, /export const dynamic = "force-dynamic"/);
  assert.match(layout, /<SiteHeader/);
  assert.match(header, /cookies\(/);
  assert.match(header, /SESSION_COOKIE/);
  assert.match(header, /getCurrentUser/);
  assert.doesNotMatch(header, /Sign in/);
});
