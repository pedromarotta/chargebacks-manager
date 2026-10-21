"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod";
import { SESSION_COOKIE, devLoginEnabled, sessionCookieOptionsFor, signSession } from "@/server/auth";
import { listUsers } from "@/server/disputes/queries";

const SwitchInput = z.object({ userId: z.string().min(1).max(40) });

/**
 * Dev-only user switch as a server action, so it works even if clicked before the page hydrates.
 * Setting the cookie inside an action makes Next re-render the current page with the new user.
 */
export async function switchUser(formData: FormData): Promise<void> {
  if (!devLoginEnabled()) return;
  const parsed = SwitchInput.safeParse({ userId: formData.get("userId") });
  const user = parsed.success ? (await listUsers()).find((u) => u.id === parsed.data.userId) : undefined;
  if (!user) return;
  (await cookies()).set(SESSION_COOKIE, signSession(user.id), sessionCookieOptionsFor(await headers()));
}
