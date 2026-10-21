import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, devLoginEnabled, sessionCookieOptionsFor, signSession } from "@/server/auth";
import { listUsers } from "@/server/disputes/queries";
import { notFound } from "@/server/http";

const LoginInput = z.object({ userId: z.string().min(1).max(40) });

/** Dev-only login used by the user switcher (R11). Disabled in production. */
export async function POST(req: Request) {
  if (!devLoginEnabled()) return notFound();
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) {
    return NextResponse.json({ error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Send the request as JSON." } }, { status: 415 });
  }
  const parsed = LoginInput.safeParse(await req.json().catch(() => null));
  const users = await listUsers();
  const user = parsed.success ? users.find((u) => u.id === parsed.data.userId) : undefined;
  if (!user) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Unknown user." } }, { status: 400 });
  }
  const res = NextResponse.json({ user });
  res.cookies.set(SESSION_COOKIE, signSession(user.id), sessionCookieOptionsFor(req.headers, req.url));
  return res;
}

export async function DELETE() {
  if (!devLoginEnabled()) return notFound();
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
