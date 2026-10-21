import { beforeAll, describe, expect, it } from "vitest";
import { assessFightOrAccept, followsRecommendation } from "@/lib/fight-or-accept";
import { prisma } from "@/server/db";
import { approveDecision, proposeDecision, rejectDecision } from "@/server/disputes/service";
import { historyFor, makeCase, seedDb, users } from "./helpers";

beforeAll(seedDb);

describe("fight-or-accept helper (backlog 0, BUSINESS_RULES §4)", () => {
  it("explains every number: recovery, fees, handling cost, expected value", () => {
    // $1,240 at 60%: recovery 744.00; cost 15 + 40% × 650 + 35 = 310.00; EV +434.00
    expect(assessFightOrAccept(124000, "USD", 60)).toEqual({
      pWinPct: 60,
      expectedRecoveryCents: 74400,
      preArbFeeCents: 1500,
      expectedArbFeeCents: 26000,
      handlingCostCents: 3500,
      expectedCostCents: 31000,
      expectedValueCents: 43400,
      recommendation: "FIGHT",
    });
    expect(assessFightOrAccept(124000, "USD", 20)?.recommendation).toBe("ACCEPT");
  });

  it("recommends accept when the expected value is exactly the threshold (0)", () => {
    // $100 at 100%: recovery 100.00; cost 15 + 0 + 35 = 50.00 → fight. $50 at 100%: EV 0 → accept.
    expect(assessFightOrAccept(10000, "USD", 100)?.recommendation).toBe("FIGHT");
    expect(assessFightOrAccept(5000, "USD", 100)).toMatchObject({ expectedValueCents: 0, recommendation: "ACCEPT" });
  });

  it("gives no recommendation when the fees aren't in the case currency or P(win) is invalid", () => {
    expect(assessFightOrAccept(10000, "EUR", 50)).toBeNull();
    expect(assessFightOrAccept(10000, "USD", 101)).toBeNull();
    expect(assessFightOrAccept(10000, "USD", 12.5)).toBeNull();
  });

  it("matches decisions to the recommendation", () => {
    expect(followsRecommendation("ESCALATE_PRE_ARB", "FIGHT")).toBe(true);
    expect(followsRecommendation("ACCEPT_LOSS_WRITE_OFF", "FIGHT")).toBe(false);
    expect(followsRecommendation("ACCEPT_LOSS_REVERSE_CREDIT", "ACCEPT")).toBe(true);
  });

  it("saves P(win), expected value and recommendation with the proposal, computed from the DB amount", async () => {
    const c = await makeCase({ status: "REPRESENTMENT_RECEIVED", amountCents: 124000 });
    const r = await proposeDecision(users.ana, c.id, {
      decisionType: "ACCEPT_LOSS_WRITE_OFF",
      note: "Analyst chooses to accept anyway.",
      pWinPct: 60,
      expectedValueCents: 999999,
      recommendation: "ACCEPT",
      amountCents: 100,
    } as never);
    expect(r).toMatchObject({ ok: true, value: { status: "DECISION_PENDING", pWinPct: 60, expectedValueCents: 43400, recommendation: "FIGHT" } });
    const h = await historyFor(c.id);
    expect(h.at(-1)?.after).toContain('"recommendation":"FIGHT"');

    // The approver sees it; approval keeps it.
    const approved = await approveDecision(users.carla, c.id, {});
    expect(approved).toMatchObject({ ok: true, value: { status: "WRITTEN_OFF", pWinPct: 60, recommendation: "FIGHT" } });
  });

  it("saves it on decisions that execute immediately, and P(win) stays optional", async () => {
    const low = await makeCase({ status: "REPRESENTMENT_RECEIVED", amountCents: 4000 });
    const r = await proposeDecision(users.ana, low.id, { decisionType: "ACCEPT_LOSS_WRITE_OFF", note: "Small amount, not worth fighting.", pWinPct: 50 });
    expect(r).toMatchObject({ ok: true, value: { status: "WRITTEN_OFF", recommendation: "ACCEPT", expectedValueCents: 2000 - 1500 - 32500 - 3500 } });

    const none = await makeCase({ status: "REPRESENTMENT_RECEIVED", amountCents: 4000 });
    const r2 = await proposeDecision(users.ana, none.id, { decisionType: "ACCEPT_LOSS_WRITE_OFF", note: "Small amount, not worth fighting." });
    expect(r2).toMatchObject({ ok: true, value: { pWinPct: null, recommendation: null } });
  });

  it("refuses an invalid P(win) and clears the helper fields on reject (history keeps them)", async () => {
    const c = await makeCase({ status: "REPRESENTMENT_RECEIVED", amountCents: 124000 });
    const bad = await proposeDecision(users.ana, c.id, { decisionType: "ESCALATE_PRE_ARB", note: "Strong evidence here.", pWinPct: 140 });
    expect(bad).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    await proposeDecision(users.ana, c.id, { decisionType: "ESCALATE_PRE_ARB", note: "Strong evidence here.", pWinPct: 70 });
    const rej = await rejectDecision(users.carla, c.id, { note: "Evidence is weaker than it looks." });
    expect(rej).toMatchObject({ ok: true, value: { status: "REPRESENTMENT_RECEIVED", pWinPct: null, expectedValueCents: null, recommendation: null } });
    const row = await prisma.history.findFirstOrThrow({ where: { disputeId: c.id, action: "decision_rejected" } });
    expect(row.before).toContain('"pWinPct":70');
  });
});
