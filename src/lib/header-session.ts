export type HeaderAccountAction =
  | { type: "link"; href: string; label: string }
  | { type: "sign-out"; label: string };

export function headerAccountActions(signedIn: boolean): HeaderAccountAction[] {
  if (!signedIn) return [{ type: "link", href: "/login", label: "Sign in" }];
  return [
    { type: "link", href: "/dashboard", label: "Dashboard" },
    { type: "sign-out", label: "Sign out" },
  ];
}

export function headerNavLinks<T extends { href: string }>(links: readonly T[], signedIn: boolean): T[] {
  if (!signedIn) return [...links];
  return links.filter((link) => link.href !== "/dashboard");
}
