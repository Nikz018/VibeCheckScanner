import type { Metadata, Viewport } from "next";
import { Figtree, Fraunces } from "next/font/google";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { DISCLAIMER, FOOTER_GROUPS } from "@/lib/seo/content";
import { rootMetadata } from "@/lib/seo/metadata";
import "./globals.css";

const sans = Figtree({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const display = Fraunces({ subsets: ["latin"], variable: "--font-display", display: "swap" });

export const dynamic = "force-dynamic";

export const metadata: Metadata = rootMetadata();

export const viewport: Viewport = {
  themeColor: "#071018",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${display.variable} font-sans antialiased`}>
        <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-5">
          <SiteHeader />
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
