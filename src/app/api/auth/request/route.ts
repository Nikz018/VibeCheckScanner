import { NextResponse } from "next/server";
import { z } from "zod";
import { requestMagicLink } from "@/lib/auth";

const bodySchema = z.object({
  email: z.string().email(),
  next: z.string().optional(),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  try {
    const result = await requestMagicLink(parsed.data.email, safeNext(parsed.data.next));
    return NextResponse.json({ ok: true, devLink: result.devLink });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not send the link." }, { status: 400 });
  }
}

function safeNext(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value.slice(0, 200);
}
