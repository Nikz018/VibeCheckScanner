import Link from "next/link";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { headerAccountActions, headerNavLinks, type HeaderAccountAction } from "@/lib/header-session";
import { NAV_LINKS } from "@/lib/seo/content";

export async function SiteHeader() {
  const jar = await cookies();
  const hasSessionCookie = Boolean(jar.get(SESSION_COOKIE)?.value);
  const user = hasSessionCookie ? await getCurrentUser() : null;
  const signedIn = Boolean(user);
  const links = headerNavLinks(NAV_LINKS, signedIn);
  const account = headerAccountActions(signedIn);

  return (
    <header className="site-header sticky top-0 z-40 -mx-5 mb-4 border-b border-white/10 bg-[#071018]/80 px-5 backdrop-blur-md">
      <div className="flex items-center justify-between gap-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-xl bg-lime font-display text-ink">
            VC
          </span>
          VibeCheck
        </Link>
        <details className="relative md:hidden">
          <summary className="btn btn-ghost cursor-pointer px-3 py-1.5 text-sm">Menu</summary>
          <div className="absolute right-0 z-50 mt-2 w-56 rounded-2xl border border-white/10 bg-[#10192c] p-3 shadow-card">
            <NavLinks links={links} account={account} />
          </div>
        </details>
        <nav aria-label="Main" className="hidden flex-wrap items-center justify-end gap-x-4 gap-y-2 text-sm text-[#d5deee] md:flex">
          <NavLinks links={links} account={account} inline />
        </nav>
      </div>
    </header>
  );
}

function NavLinks({
  links,
  account,
  inline = false,
}: {
  links: readonly { href: string; label: string }[];
  account: HeaderAccountAction[];
  inline?: boolean;
}) {
  return (
    <div className={inline ? "contents" : "grid gap-2 text-sm"}>
      {links.map((link) => (
        <Link key={link.href} href={link.href} className="rounded-full px-1 py-1 hover:text-lime">
          {link.label}
        </Link>
      ))}
      {account.map((action) =>
        action.type === "sign-out" ? (
          <form key={action.label} action="/api/auth/logout" method="post">
            <button className="btn btn-ghost px-3 py-1.5 text-sm" type="submit">
              {action.label}
            </button>
          </form>
        ) : (
          <Link key={action.href} href={action.href} className="btn btn-lime px-3 py-1.5 text-sm">
            {action.label}
          </Link>
        ),
      )}
    </div>
  );
}
