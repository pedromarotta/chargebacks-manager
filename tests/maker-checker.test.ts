import { beforeAll, describe, expect, it } from "vitest";
import { approveDecision, proposeDecision, rejectDecision } from "@/server/disputes/service";
import { prisma } from "@/server/db";
import { historyFor, makeCase, networkCallsFor, seedDb, users } from "./helpers";

beforeAll(seedDb);

describe("R4 maker-checker", () => {
  it("the proposer cannot approve or reject their own decision, even as a lead (R4)", async () => {
    const approve = await approveDecision(users.carla, "CB-1088", {});
    expect(approve).toMatchObject({ ok: false, code: "SELF_APPROVAL_BLOCKED", httpStatus: 409 });
    const reject = await rejectDecision(users.carla, "CB-1088", { note: "changing my mind on this" });
    expect(reject).toMatchObject({ ok: false, code: "SELF_APPROVAL_BLOCKED" });

    const d = await prisma.dispute.findUniqueOrThrow({ where: { id: "CB-1088" } });
    expect(d.status).toBe("DECISION_PENDING");
    const blocked = (await historyFor("CB-1088")).filter((h) => h.action === "decision_blocked");
    expect(blocked).toHaveLength(2);
    expect(blocked[0].actorId).toBe("u_carla");
  });

  it("an analyst's own proposal can't be approved by them even if promoted to lead (R4)", async () => {
    const c = await makeCase({ amountCents: 80000 });
    expect((await proposeDecision(users.carla, c.id, { decisionType: "ACCEPT_LOSS_WRITE_OFF", note: "merchant evidence is solid" })).ok).toBe(true);
    expect(await approveDecision(users.carla, c.id, {})).toMatchObject({ ok: false, code: "SELF_APPROVAL_BLOCKED" });
  });

  it("a different lead can approve: Eve approves Carla's CB-1088 (positive control)", async () => {
    const result = await approveDecision(users.eve, "CB-1088", { comment: "Agree, escalate." });
    expect(result.ok).toBe(true);
    const d = await prisma.dispute.findUniqueOrThrow({ where: { id: "CB-1088" } });
    expect(d.status).toBe("PRE_ARB_FILED");
    expect(d.decidedBy).toBe("u_eve");
    const calls = await networkCallsFor("CB-1088");
    expect(calls.filter((c) => c.message === "PRE_ARB")).toHaveLength(1);
  });
});
