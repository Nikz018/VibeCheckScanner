"use client";

import { usePathname } from "next/navigation";

/** Home keeps the full corner glow. Other routes use a quieter glow so the copy stays easy to read. */
export function ThemeAtmosphere() {
  const pathname = usePathname() || "/";
  const atmosphere = pathname === "/" ? "home" : "quiet";
  return <div className="atmosphere" data-atmosphere={atmosphere} aria-hidden="true" />;
}
