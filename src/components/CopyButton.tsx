"use client";

import { useEffect, useRef, useState } from "react";

export function CopyButton({
  value,
  label,
  tone = "light",
  text = "Copy",
}: {
  value: string;
  label: string;
  tone?: "light" | "dark";
  text?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        copyWithTextarea(value);
      }
      setState("copied");
    } catch {
      try {
        copyWithTextarea(value);
        setState("copied");
      } catch {
        setState("failed");
      }
    }
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2000);
  }

  const toneClass =
    tone === "dark"
      ? "border-white/30 text-white hover:bg-white/10"
      : "border-[#071018]/20 text-ink hover:bg-[#071018]/5";
  const shown = state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : text;

  return (
    <button
      type="button"
      className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold ${toneClass}`}
      onClick={() => void copy()}
      aria-live="polite"
      aria-label={state === "copied" ? `${label} copied` : state === "failed" ? `Could not copy ${label}` : `Copy ${label}`}
    >
      {shown}
    </button>
  );
}

function copyWithTextarea(value: string): void {
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.focus();
  area.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(area);
  if (!ok) throw new Error("copy failed");
}
