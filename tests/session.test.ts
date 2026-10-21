import { beforeAll, describe, expect, it, vi } from "vitest";
import { signSession, userFromSessionCookie, verifySession } from "@/server/auth";
import { seedDb } from "./helpers";

const cookieJar = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieJar.value ? { name: "cbm_session", value: cookieJar.value } : undefined) }),
}));

beforeAll(seedDb);

async function approveViaApi(cookie: string | undefined) {
  cookieJar.value = cookie;
  const { POST } = await import("@/app/api/disputes/[id]/[action]/route");
  return POST(
    new Request("http://localhost/api/disputes/CB-1088/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
    { params: Promise.resolve({ id: "CB-1088", action: "approve" }) },
  );
}

describe("R11 session", () => {
  it("a tampered, unsigned or missing session cookie gets 401 (R11)", async () => {
    const valid = signSession("u_eve");
    const tampered = valid.replace("u_eve", "u_carla");
    for (const cookie of [tampered, "u_eve", `u_eve.${"A".repeat(43)}`, undefined]) {
      const res = await approveViaApi(cookie);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    }
    expect(verifySession(tampered)).toBeNull();
  });

  it("a correctly signed cookie resolves to the user re-read from the database (R11, positive control)", async () => {
    expect(await userFromSessionCookie(signSession("u_eve"))).toEqual({ id: "u_eve", name: "Eve Park", role: "lead" });
    expect(await userFromSessionCookie(signSession("u_nobody"))).toBeNull();
    const res = await approveViaApi(signSession("u_eve"));
    expect(res.status).toBe(200);
  });

  it("dev login is disabled when NODE_ENV=production (R11)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(await userFromSessionCookie(signSession("u_eve"))).toBeNull();
      const { POST } = await import("@/app/api/session/route");
      const res = await POST(
        new Request("http://localhost/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: "u_eve" }),
        }),
      );
      expect(res.status).toBe(404);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
