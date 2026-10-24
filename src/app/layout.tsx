import type { Metadata } from "next";
import { Figtree, Fraunces } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const sans = Figtree({ subsets: ["latin"], variable: "--font-sans" });
const display = Fraunces({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: {
    default: "VibeCheck — security reports for vibe-coded apps",
    template: "%s · VibeCheck",
  },
  description: "Scan a Lovable, Bolt, Supabase, or Firebase app you own and get a point-in-time security report with fixes.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${display.variable} font-sans antialiased`}>
        <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-5">
          <header className="flex items-center justify-between py-5">
            <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-lime font-display text-ink">VC</span>
              VibeCheck
            </Link>
            <nav className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-sm text-[#d9d3c5]">
              <Link href="/#pricing">Pricing</Link>
              <Link href="/demo-report">Sample report</Link>
              <Link href="/check">Mini check</Link>
              <Link href="/dashboard">Dashboard</Link>
              <Link href="/login" className="btn btn-lime px-3 py-1.5 text-sm">
                Sign in
              </Link>
            </nav>
          </header>
          <main className="flex-1">{children}</main>
          <footer className="py-10 text-sm text-[#b7b1a4]">
            VibeCheck scans origins you prove you own. Reports are a point-in-time look at findings and fixes, not a certification.
          </footer>
        </div>
      </body>
    </html>
  );
}
