import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { getDueSoonDigest } from "@/server/disputes/digest";
import { makeCase, seedDb, users } from "./helpers";

const H = 3_600_000;
const now = new Date();

async function caseDueIn(hours: number, over: Parameters<typeof makeCase>[0] = {}) {
  const c = await makeCase(over);
  return prisma.dispute.update({ where: { id: c.id }, data: { dueAt: new Date(now.getTime() + hours * H) } });
}

beforeAll(seedDb);

describe("due-soon digest (backlog 7)", () => {
  it("lists open cases due within 48h, grouped and sorted; excludes later and closed cases", async () => {
    const past = await caseDueIn(-2, { status: "NEW" });
    const soon = await caseDueIn(3, { status: "REPRESENTMENT_RECEIVED" });
    const day = await caseDueIn(30, { status: "CHARGEBACK_FILED" });
    const edge = await caseDueIn(48, { status: "PRE_ARB_FILED" });
    const later = await caseDueIn(49, { status: "NEW" });
    const closed = await caseDueIn(1, { status: "CLOSED_WON" });
    const expired = await caseDueIn(-5, { status: "EXPIRED" });

    const r = await getDueSoonDigest(users.ana, now);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = (k: string) => r.value.groups.find((g) => g.key === k)!.items.map((i) => i.id);
    expect(ids("past_due")).toContain(past.id);
    expect(ids("today")).toContain(soon.id);
    expect(ids("tomorrow")).toEqual(expect.arrayContaining([day.id, edge.id]));
    const all = r.value.groups.flatMap((g) => g.items.map((i) => i.id));
    for (const id of [later.id, closed.id, expired.id]) expect(all).not.toContain(id);
    expect(all.indexOf(day.id)).toBeLessThan(all.indexOf(edge.id));
    expect(r.value.total).toBe(all.length);
  });

  it("tells each user the next step and whether it's theirs", async () => {
    const pendingCarla = await caseDueIn(5, { status: "DECISION_PENDING", decisionType: "ACCEPT_LOSS_WRITE_OFF", proposedBy: "u_carla" });
    const step = async (actor: (typeof users)["ana"], id: string) => {
      const r = await getDueSoonDigest(actor, now);
      return r.ok ? r.value.groups.flatMap((g) => g.items).find((i) => i.id === id) : undefined;
    };
    expect(await step(users.eve, pendingCarla.id)).toMatchObject({ nextStep: "Approve or reject the proposed decision", needsYou: true });
    expect(await step(users.carla, pendingCarla.id)).toMatchObject({ needsYou: false, nextStep: expect.stringMatching(/different lead/) });
    expect(await step(users.ana, pendingCarla.id)).toMatchObject({ needsYou: false });
    const fresh = await caseDueIn(5, { status: "NEW" });
    expect(await step(users.ana, fresh.id)).toMatchObject({ needsYou: true });
    expect(await step(users.dan, fresh.id)).toMatchObject({ needsYou: false });
  });

  it("is read-only: never expires or writes history, and needs a session", async () => {
    const past = await caseDueIn(-1, { status: "NEW" });
    const before = await prisma.history.count();
    await getDueSoonDigest(users.dan, now);
    expect(await prisma.history.count()).toBe(before);
    expect((await prisma.dispute.findUniqueOrThrow({ where: { id: past.id } })).status).toBe("NEW");
    expect(await getDueSoonDigest(null, now)).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });
});
