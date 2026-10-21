import { beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/disputes/bulk-write-off/route";
import { prisma } from "@/server/db";
import { bulkWriteOff } from "@/server/disputes/service";
import { signSession } from "@/server/auth";
import { makeCase, seedDb, users } from "./helpers";

const cookieJar = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieJar.value ? { name: "cbm_session", value: cookieJar.value } : undefined) }),
}));

beforeAll(seedDb);

const NOTE = "Small amounts, not worth fighting.";
const historyFor = (id: string) => prisma.history.findMany({ where: { disputeId: id }, orderBy: { id: "asc" } });

describe("bulk write-off (backlog 4)", () => {
  it("writes off each case under $500, one history row and one network call per case", async () => {
    const cases = await Promise.all([1999, 25000, 49999].map((amountCents) => makeCase({ status: "REPRESENTMENT_RECEIVED", amountCents, provisionalCreditCents: amountCents })));
    const calls = await prisma.networkCall.count();
    const r = await bulkWriteOff(users.ana, { ids: cases.map((c) => c.id), note: NOTE });
    expect(r).toMatchObject({ ok: true, value: { writtenOff: 3, refused: 0 } });
    expect(await prisma.networkCall.count()).toBe(calls + 3);
    const bulkId = r.ok ? r.value.bulkId : "";
    for (const c of cases) {
      const d = await prisma.dispute.findUniqueOrThrow({ where: { id: c.id } });
      expect(d).toMatchObject({ status: "WRITTEN_OFF", decisionType: "ACCEPT_LOSS_WRITE_OFF", proposedBy: "u_ana", decidedBy: "u_ana", provisionalCreditCents: c.amountCents, proposalNote: NOTE });
      const rows = await historyFor(c.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe("decision_executed");
      expect(JSON.parse(rows[0].after ?? "{}").bulkId).toBe(bulkId);
    }
  });

  it("refuses cases at $500 or at the wrong step, and still writes off the rest", async () => {
    const small = await makeCase({ status: "REPRESENTMENT_RECEIVED", amountCents: 1000 });
    const big = await makeCase({ status: "REPRESENTMENT_RECEIVED", amountCents: 50000 });
    const fresh = await makeCase({ status: "NEW", amountCents: 1000 });
    const late = await makeCase({ status: "REPRESENTMENT_RECEIVED", amountCents: 1000, dueInDays: -1 });
    const r = await bulkWriteOff(users.ben, { ids: [small.id, big.id, fresh.id, late.id, "NOPE-1"], note: NOTE });
    expect(r).toMatchObject({ ok: true, value: { writtenOff: 1, refused: 4 } });
    const byId = Object.fromEntries((r.ok ? r.value.results : []).map((x) => [x.id, x]));
    expect(byId[big.id].message).toMatch(/under \$500\.00/);
    expect(byId[big.id].message).not.toMatch(/BULK_LIMIT/);
    expect((await prisma.dispute.findUniqueOrThrow({ where: { id: big.id } })).status).toBe("REPRESENTMENT_RECEIVED");
    expect((await prisma.dispute.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe("NEW");
    expect((await prisma.dispute.findUniqueOrThrow({ where: { id: late.id } })).status).toBe("EXPIRED");
    for (const c of [big, fresh, late]) {
      const rows = await historyFor(c.id);
      expect(rows).toHaveLength(1);
      expect(JSON.parse(rows[0].after ?? "{}")).toMatchObject({ attempted: "bulk_write_off" });
    }
  });

  it("is safe to repeat: a second run refuses every case and makes no new network call", async () => {
    const a = await makeCase({ status: "REPRESENTMENT_RECEIVED", amountCents: 1000 });
    await bulkWriteOff(users.ana, { ids: [a.id], note: NOTE });
    const calls = await prisma.networkCall.count();
    expect(await bulkWriteOff(users.ana, { ids: [a.id], note: NOTE })).toMatchObject({ ok: true, value: { writtenOff: 0, refused: 1 } });
    expect(await prisma.networkCall.count()).toBe(calls);
  });

  it("refuses the whole request once for bad role, note or selection, changing nothing", async () => {
    const a = await makeCase({ status: "REPRESENTMENT_RECEIVED", amountCents: 1000 });
    const before = await prisma.history.count();
    expect(await bulkWriteOff(users.dan, { ids: [a.id], note: NOTE })).toMatchObject({ ok: false, code: "ROLE_NOT_ALLOWED" });
    expect(await bulkWriteOff(users.ana, { ids: [a.id], note: "short" })).toMatchObject({ ok: false, code: "NOTE_TOO_SHORT" });
    expect(await bulkWriteOff(users.ana, { ids: [a.id, a.id], note: NOTE })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await bulkWriteOff(users.ana, { ids: [], note: NOTE })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await bulkWriteOff(null, { ids: [a.id], note: NOTE })).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(await prisma.history.count()).toBe(before + 4);
    expect((await prisma.dispute.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("REPRESENTMENT_RECEIVED");
  });

  it("route: 401 without a session, 403 for the auditor, 200 for an analyst, 415 for a form post", async () => {
    const a = await makeCase({ status: "REPRESENTMENT_RECEIVED", amountCents: 1000 });
    const json = (body: unknown) => new Request("http://x/api/disputes/bulk-write-off", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    cookieJar.value = undefined;
    expect((await POST(json({ ids: [a.id], note: NOTE }))).status).toBe(401);
    cookieJar.value = signSession("u_dan");
    expect((await POST(json({ ids: [a.id], note: NOTE }))).status).toBe(403);
    cookieJar.value = signSession("u_ana");
    const okRes = await POST(json({ ids: [a.id], note: NOTE }));
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toMatchObject({ writtenOff: 1 });
    cookieJar.value = undefined;
    const res = await POST(new Request("http://x/api/disputes/bulk-write-off", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(res.status).toBe(401);
    const form = await POST(new Request("http://x/api/disputes/bulk-write-off", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "ids=1" }));
    expect(form.status).toBe(415);
  });
});
