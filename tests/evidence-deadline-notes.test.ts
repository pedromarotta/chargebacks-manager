import { beforeAll, describe, expect, it } from "vitest";
import { approveDecision, fileChargeback, proposeDecision, rejectDecision, setEvidence } from "@/server/disputes/service";
import { prisma } from "@/server/db";
import { historyFor, makeCase, networkCallsFor, seedDb, users } from "./helpers";

beforeAll(seedDb);

describe("R2 evidence", () => {
  it("filing without the required evidence is refused (R2)", async () => {
    const c = await makeCase({ status: "NEW", reasonCode: "FRAUD" });
    const r = await fileChargeback(users.ana, c.id);
    expect(r).toMatchObject({ ok: false, code: "EVIDENCE_REQUIRED", httpStatus: 409 });
    expect(await networkCallsFor(c.id)).toHaveLength(0);
    expect((await prisma.dispute.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("NEW");
  });

  it("filing with every required item checked sends one CHARGEBACK (R2, positive control)", async () => {
    const c = await makeCase({ status: "NEW", reasonCode: "FRAUD" });
    expect((await setEvidence(users.ana, c.id, { key: "fraud_affidavit", checked: true })).ok).toBe(true);
    expect((await setEvidence(users.ana, c.id, { key: "statement", checked: true })).ok).toBe(true);
    const r = await fileChargeback(users.ana, c.id);
    expect(r).toMatchObject({ ok: true, value: { status: "CHARGEBACK_FILED" } });
    expect((await networkCallsFor(c.id)).map((n) => n.message)).toEqual(["CHARGEBACK"]);
    expect(await fileChargeback(users.ana, c.id)).toMatchObject({ ok: false, code: "INVALID_STATUS" });
    expect(await networkCallsFor(c.id)).toHaveLength(1);
  });
});

describe("R1 deadline", () => {
  it("nothing can be filed, proposed, approved or rejected after the deadline (R1)", async () => {
    const toFile = await makeCase({ status: "NEW", evidenceChecked: true, dueInDays: -0.01 });
    const toPropose = await makeCase({ dueInDays: -0.01 });
    const toApprove = await makeCase({ status: "DECISION_PENDING", amountCents: 90000, decisionType: "ACCEPT_LOSS_WRITE_OFF", proposedBy: "u_ana", dueInDays: -0.01 });
    const toReject = await makeCase({ status: "DECISION_PENDING", amountCents: 90000, decisionType: "ACCEPT_LOSS_WRITE_OFF", proposedBy: "u_ana", dueInDays: -0.01 });

    const results = [
      await fileChargeback(users.ana, toFile.id),
      await proposeDecision(users.ana, toPropose.id, { decisionType: "ACCEPT_LOSS_WRITE_OFF", note: "late but accepting" }),
      await approveDecision(users.carla, toApprove.id, {}),
      await rejectDecision(users.carla, toReject.id, { note: "late rejection attempt" }),
    ];
    for (const r of results) expect(r).toMatchObject({ ok: false, code: "PAST_DEADLINE", httpStatus: 409 });
    for (const c of [toFile, toPropose, toApprove, toReject]) {
      expect((await prisma.dispute.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("EXPIRED");
      expect(await networkCallsFor(c.id)).toHaveLength(0);
      const h = await historyFor(c.id);
      expect(h).toHaveLength(1);
      expect(JSON.parse(h[0].after ?? "{}")).toMatchObject({ code: "PAST_DEADLINE", status: "EXPIRED" });
    }
  });
});

describe("R6 notes", () => {
  it("proposing or rejecting with a note under 10 characters is refused (R6)", async () => {
    const c = await makeCase({ amountCents: 90000 });
    expect(await proposeDecision(users.ana, c.id, { decisionType: "ESCALATE_PRE_ARB", note: "  short   " })).toMatchObject({ ok: false, code: "NOTE_TOO_SHORT", httpStatus: 400 });
    expect(await proposeDecision(users.ana, c.id, { decisionType: "ESCALATE_PRE_ARB" })).toMatchObject({ ok: false, code: "NOTE_TOO_SHORT" });
    expect((await proposeDecision(users.ana, c.id, { decisionType: "ESCALATE_PRE_ARB", note: "Merchant evidence is weak." })).ok).toBe(true);
    expect(await rejectDecision(users.carla, c.id, { note: "no" })).toMatchObject({ ok: false, code: "NOTE_TOO_SHORT" });
    const rejected = await rejectDecision(users.carla, c.id, { note: "Fee is not worth it here." });
    expect(rejected).toMatchObject({ ok: true, value: { status: "REPRESENTMENT_RECEIVED", decisionType: null, proposedBy: null } });
    const approvedWithoutNote = await makeCase({ status: "DECISION_PENDING", amountCents: 90000, decisionType: "ACCEPT_LOSS_WRITE_OFF", proposedBy: "u_ana" });
    expect((await approveDecision(users.carla, approvedWithoutNote.id, undefined)).ok).toBe(true);
  });
});
