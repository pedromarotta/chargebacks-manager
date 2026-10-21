import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { isRole, type Actor } from "./domain";

export const SESSION_COOKIE = "cbm_session";

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET must be set to at least 16 characters");
  }
  return secret;
}

function mac(userId: string): string {
  return createHmac("sha256", sessionSecret()).update(userId).digest("base64url");
}

export function devLoginEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** Cookie value: `<userId>.<HMAC-SHA256(userId)>` (R11). */
export function signSession(userId: string): string {
  return `${userId}.${mac(userId)}`;
}

/** Returns the user id if the cookie is present and correctly signed, otherwise null. */
export function verifySession(value: string | null | undefined): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(mac(userId));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return userId;
}

/** Resolves a raw cookie value to a user, re-reading the user from the database every time. */
export async function userFromSessionCookie(value: string | null | undefined): Promise<Actor | null> {
  if (!devLoginEnabled()) return null;
  const userId = verifySession(value);
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !isRole(user.role)) return null;
  return { id: user.id, name: user.name, role: user.role };
}

/** The only identity seam: a signed dev cookie today, OIDC later. */
export async function getCurrentUser(): Promise<Actor | null> {
  const store = await cookies();
  return userFromSessionCookie(store.get(SESSION_COOKIE)?.value);
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Session cookie flags. `Secure` everywhere except plain-HTTP localhost, so the cookie never crosses a network in clear text. */
export function sessionCookieOptions(requestUrl: string, forwardedProto?: string | null) {
  const url = new URL(requestUrl);
  const https = url.protocol === "https:" || forwardedProto?.split(",")[0]?.trim() === "https";
  return { httpOnly: true, sameSite: "lax" as const, path: "/", secure: https || !LOCAL_HOSTS.has(url.hostname) };
}

/** Same flags, from the incoming request headers (behind a proxy, the original host and scheme are forwarded). */
export function sessionCookieOptionsFor(h: Headers, fallbackUrl = "http://localhost/") {
  const host = h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host");
  const proto = h.get("x-forwarded-proto");
  const scheme = proto?.split(",")[0]?.trim() === "https" ? "https" : "http";
  return sessionCookieOptions(host ? `${scheme}://${host}/` : fallbackUrl, proto);
}
