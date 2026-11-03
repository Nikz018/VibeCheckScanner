"use client";

import Link from "next/link";
import { CopyButton } from "@/components/CopyButton";
import {
  OWNERSHIP_GUIDE_LINK_LABEL,
  OWNERSHIP_GUIDE_PATH,
  OWNERSHIP_NOT_FOUND_HINT,
  isOwnershipNotFound,
} from "@/lib/ownership-guide";

export function OwnershipGuideLink({ tone = "light", variant = "button" }: { tone?: "light" | "dark"; variant?: "button" | "text" }) {
  const className =
    variant === "text"
      ? tone === "dark"
        ? "font-semibold text-lime underline"
        : "font-semibold underline"
      : tone === "dark"
        ? "btn btn-ghost px-3 py-1.5 text-sm"
        : "btn btn-ghost-ink px-3 py-1.5 text-sm";
  return (
    <Link href={OWNERSHIP_GUIDE_PATH} target="_blank" rel="noopener noreferrer" className={className}>
      {OWNERSHIP_GUIDE_LINK_LABEL}
      <span className="sr-only"> (opens in a new tab)</span>
    </Link>
  );
}

export function OwnershipProofFields({
  host,
  value,
  url,
  body,
  tone = "light",
  className = "",
}: {
  host: string;
  value: string;
  url: string;
  body: string;
  tone?: "light" | "dark";
  className?: string;
}) {
  const card = tone === "light" ? "rounded-2xl bg-white p-4 text-sm text-ink" : "rounded-2xl bg-white/10 p-4 text-sm";
  const muted = tone === "light" ? "text-[#44554c]" : "text-[#d9d3c5]";
  return (
    <div className={className}>
      <OwnershipGuideLink tone={tone} />
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <article className={card}>
          <h3 className="font-semibold">DNS TXT</h3>
          <ProofRow label="Host" value={host} tone={tone} muted={muted} />
          <ProofRow label="Value" value={value} tone={tone} muted={muted} />
        </article>
        <article className={card}>
          <h3 className="font-semibold">Well-known file</h3>
          <ProofRow label="URL" value={url} tone={tone} muted={muted} />
          <ProofRow label="Body" value={body} tone={tone} muted={muted} />
        </article>
      </div>
    </div>
  );
}

export function OwnershipNotFoundHint({ message, tone = "light" }: { message: string; tone?: "light" | "dark" }) {
  if (!isOwnershipNotFound(message)) return null;
  const color = tone === "light" ? "text-[#8a2d18]" : "text-[#f3c7bc]";
  return (
    <p className={`mt-2 text-sm ${color}`}>
      {OWNERSHIP_NOT_FOUND_HINT} <OwnershipGuideLink tone={tone} variant="text" />
    </p>
  );
}

function ProofRow({ label, value, tone, muted }: { label: string; value: string; tone: "light" | "dark"; muted: string }) {
  return (
    <div className="mt-3">
      <p className={`text-xs font-semibold uppercase tracking-wide ${muted}`}>{label}</p>
      <p className="mt-1 break-all">{value}</p>
      <div className="mt-2">
        <CopyButton value={value} label={label} tone={tone} text={`Copy ${label}`} />
      </div>
    </div>
  );
}
