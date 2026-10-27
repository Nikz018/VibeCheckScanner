import Link from "next/link";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { headerAccountActions, headerNavLinks } from "@/lib/header-session";
import { NAV_LINKS } from "@/lib/seo/content";

export async function SiteHeader() {
  const jar = await cookies();
  const hasSessionCookie = Boolean(jar.get(SESSION_COOKIE)?.value);
  const user = hasSessionCookie ? await getCurrentUser() : null;
  const signedIn = Boolean(user);
  const links = headerNavLinks(NAV_LINKS, signedIn);
  const account = headerAccountActions(signedIn);

  return (
    <header className="flex items-center justify-between gap-4 py-5">
      <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-xl bg-lime font-display text-ink">
          VC
        </span>
        VibeCheck
      </Link>
      <nav aria-label="Main" className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-sm text-[#d9d3c5]">
        {links.map((link) => (
          <Link key={link.href} href={link.href}>
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
      </nav>
    </header>
  );
}
