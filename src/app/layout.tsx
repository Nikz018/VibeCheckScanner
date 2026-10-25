import type { Metadata, Viewport } from "next";
import { Figtree, Fraunces } from "next/font/google";
import Link from "next/link";
import { DISCLAIMER, FOOTER_GROUPS, NAV_LINKS } from "@/lib/seo/content";
import { rootMetadata } from "@/lib/seo/metadata";
import "./globals.css";

const sans = Figtree({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const display = Fraunces({ subsets: ["latin"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = rootMetadata();

export const viewport: Viewport = {
  themeColor: "#101410",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${display.variable} font-sans antialiased`}>
        <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-5">
          <header className="flex items-center justify-between gap-4 py-5">
            <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-xl bg-lime font-display text-ink">
                VC
              </span>
              VibeCheck
            </Link>
            <nav aria-label="Main" className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-sm text-[#d9d3c5]">
              {NAV_LINKS.map((link) => (
                <Link key={link.href} href={link.href}>
                  {link.label}
                </Link>
              ))}
              <Link href="/login" className="btn btn-lime px-3 py-1.5 text-sm">
                Sign in
              </Link>
            </nav>
          </header>
          <main className="flex-1">{children}</main>
          <footer className="mt-16 border-t border-white/10 py-10 text-sm text-[#b7b1a4]">
            <div className="grid gap-8 sm:grid-cols-2">
              {FOOTER_GROUPS.map((group) => (
                <nav key={group.title} aria-label={group.title}>
                  <p className="text-xs uppercase tracking-[0.16em] text-[#d9d3c5]">{group.title}</p>
                  <ul className="mt-3 space-y-2">
                    {group.links.map((link) => (
                      <li key={link.href}>
                        <Link className="hover:text-lime" href={link.href}>
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              ))}
            </div>
            <p className="mt-8 max-w-3xl">{DISCLAIMER}</p>
          </footer>
        </div>
      </body>
    </html>
  );
}
