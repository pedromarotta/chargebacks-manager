import { beforeAll, describe, expect, it } from "vitest";
import { approveDecision, proposeDecision } from "@/server/disputes/service";
import { prisma } from "@/server/db";
import { makeCase, networkCallsFor, seedDb, users } from "./helpers";

beforeAll(seedDb);

describe("R7 and R8: exactly once", () => {
  it("approving twice, or twice at the same time, makes exactly one NetworkCall (R7, R8)", async () => {
    const first = await approveDecision(users.eve, "CB-1088", {});
    expect(first.ok).toBe(true);
    expect(await approveDecision(users.eve, "CB-1088", {})).toMatchObject({ ok: false, code: "ALREADY_DECIDED", httpStatus: 409 });
    expect((await networkCallsFor("CB-1088")).filter((c) => c.message === "PRE_ARB")).toHaveLength(1);

    const c = await makeCase({ status: "DECISION_PENDING", amountCents: 90000, decisionType: "ACCEPT_LOSS_REVERSE_CREDIT", proposedBy: "u_ana" });
    const results = await Promise.all([
      approveDecision(users.carla, c.id, {}),
      approveDecision(users.eve, c.id, {}),
      approveDecision(users.carla, c.id, {}),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).map((r) => (r.ok ? null : r.code))).toEqual(["ALREADY_DECIDED", "ALREADY_DECIDED"]);
    expect((await networkCallsFor(c.id)).filter((n) => n.message === "ACCEPT")).toHaveLength(1);
  });

  it("a decision on a case not at the right status is refused (R7)", async () => {
    const fresh = await makeCase({ status: "NEW" });
    expect(await proposeDecision(users.ana, fresh.id, { decisionType: "ACCEPT_LOSS_WRITE_OFF", note: "too early to decide" })).toMatchObject({ ok: false, code: "INVALID_STATUS" });
    expect(await approveDecision(users.carla, fresh.id, {})).toMatchObject({ ok: false, code: "ALREADY_DECIDED" });
  });

  it("reversing the credit sets it to 0; writing off keeps it", async () => {
    const reverse = await makeCase({ amountCents: 20000 });
    const writeOff = await makeCase({ amountCents: 20000 });
    await proposeDecision(users.ana, reverse.id, { decisionType: "ACCEPT_LOSS_REVERSE_CREDIT", note: "Cardholder authenticated." });
    await proposeDecision(users.ana, writeOff.id, { decisionType: "ACCEPT_LOSS_WRITE_OFF", note: "Absorb, below cost to fight." });
    const r = await prisma.dispute.findUniqueOrThrow({ where: { id: reverse.id } });
    const w = await prisma.dispute.findUniqueOrThrow({ where: { id: writeOff.id } });
    expect([r.status, r.provisionalCreditCents]).toEqual(["CLOSED_LOST", 0]);
    expect([w.status, w.provisionalCreditCents]).toEqual(["WRITTEN_OFF", 20000]);
  });
});
