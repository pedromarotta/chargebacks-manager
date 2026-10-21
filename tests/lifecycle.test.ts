import { beforeAll, describe, expect, it } from "vitest";
import { buildTimeline } from "@/lib/timeline";
import { prisma } from "@/server/db";
import { getCase } from "@/server/disputes/queries";
import { NETWORK_ACTOR, approveDecision, proposeDecision, rejectDecision, rejectFiling } from "@/server/disputes/service";
import { makeCase, networkCallsFor, seedDb, users } from "./helpers";

beforeAll(seedDb);

async function timelineOf(id: string) {
  const r = await getCase(users.dan, id);
  if (!r.ok) throw new Error(r.message);
  return buildTimeline(r.value.dispute, r.value.history);
}
const states = (steps: { state: string }[]) => steps.map((s) => s.state);

describe("lifecycle timeline and rejected filing (backlog 8)", () => {
  it("shows the 8 steps with the first incomplete one current", async () => {
    const c = await makeCase({ status: "REPRESENTMENT_RECEIVED" });
    const steps = buildTimeline(
      { status: c.status, decisionType: null, openedAt: c.openedAt.toISOString(), filingRejectedAt: null, filingRejectReason: null },
      [
        { action: "chargeback_filed", at: "2026-10-01T00:00:00.000Z", after: { status: "CHARGEBACK_FILED" } },
        { action: "representment_received", at: "2026-10-05T00:00:00.000Z", after: { status: "REPRESENTMENT_RECEIVED" } },
      ],
    );
    expect(steps.map((s) => s.title)).toEqual(["Intake", "Validation", "Filing", "Evidence", "Representment", "Analysis", "Pre-arbitration", "Arbitration"]);
    expect(states(steps)).toEqual(["done", "done", "done", "done", "done", "current", "upcoming", "upcoming"]);
    expect(steps[4].at).toBe("2026-10-05T00:00:00.000Z");
  });

  it("accepted loss skips pre-arb and arbitration; expiry fails the current step", () => {
    const base = { decisionType: "ACCEPT_LOSS_WRITE_OFF", openedAt: "2026-09-01T00:00:00.000Z", filingRejectedAt: null, filingRejectReason: null };
    const hist = [
      { action: "chargeback_filed", at: "2026-09-02T00:00:00.000Z", after: {} },
      { action: "representment_received", at: "2026-09-03T00:00:00.000Z", after: {} },
      { action: "decision_executed", at: "2026-09-04T00:00:00.000Z", after: { status: "WRITTEN_OFF" } },
    ];
    expect(states(buildTimeline({ ...base, status: "WRITTEN_OFF" }, hist))).toEqual(["done", "done", "done", "done", "done", "done", "skipped", "skipped"]);
    const exp = buildTimeline({ ...base, decisionType: null, status: "EXPIRED" }, [{ action: "action_refused", at: "2026-09-09T00:00:00.000Z", after: { status: "EXPIRED" } }]);
    expect(states(exp)).toEqual(["done", "failed", "skipped", "skipped", "skipped", "skipped", "skipped", "skipped"]);
  });

  it("rejected filing: step 3 fails, 4–8 don't apply, ops review writes it off without a network call", async () => {
    const c = await makeCase({ status: "CHARGEBACK_FILED", amountCents: 20000 });
    expect(await rejectFiling(users.ana, c.id, { reason: "Outside time frame" })).toMatchObject({ ok: false, code: "ROLE_NOT_ALLOWED" });
    const r = await rejectFiling(NETWORK_ACTOR, c.id, { reason: "Outside the network time frame" });
    expect(r).toMatchObject({ ok: true, value: { status: "FILING_REJECTED" } });
    expect(await rejectFiling(NETWORK_ACTOR, c.id, { reason: "again" })).toMatchObject({ ok: false, code: "INVALID_STATUS" });

    let steps = await timelineOf(c.id);
    expect(states(steps)).toEqual(["done", "done", "failed", "skipped", "skipped", "skipped", "skipped", "skipped", "current"]);
    expect(steps[2].detail).toContain("Outside the network time frame");
    expect(steps[8].title).toBe("Ops review");

    expect(await proposeDecision(users.ana, c.id, { decisionType: "ESCALATE_PRE_ARB", note: "Try pre-arb anyway." })).toMatchObject({ ok: false, code: "INVALID_STATUS" });
    const calls = (await networkCallsFor(c.id)).length;
    expect(await proposeDecision(users.ana, c.id, { decisionType: "ACCEPT_LOSS_WRITE_OFF", note: "Rejected by network, absorb it." })).toMatchObject({ ok: true, value: { status: "WRITTEN_OFF" } });
    expect((await networkCallsFor(c.id)).length).toBe(calls);
    steps = await timelineOf(c.id);
    expect(steps[8]).toMatchObject({ state: "done", detail: expect.stringMatching(/Written off/) });
  });

  it("over-threshold ops review needs maker-checker; a rejected proposal returns to FILING_REJECTED", async () => {
    const c = await makeCase({ status: "CHARGEBACK_FILED", amountCents: 90000 });
    await rejectFiling(NETWORK_ACTOR, c.id, { reason: "Duplicate filing" });
    await proposeDecision(users.carla, c.id, { decisionType: "ACCEPT_LOSS_REVERSE_CREDIT", note: "Reverse the credit, filing rejected." });
    expect(await approveDecision(users.carla, c.id, {})).toMatchObject({ ok: false, code: "SELF_APPROVAL_BLOCKED" });
    expect(await rejectDecision(users.eve, c.id, { note: "Write it off instead please." })).toMatchObject({ ok: true, value: { status: "FILING_REJECTED" } });
    await proposeDecision(users.carla, c.id, { decisionType: "ACCEPT_LOSS_REVERSE_CREDIT", note: "Reverse the credit, filing rejected." });
    expect(await approveDecision(users.eve, c.id, {})).toMatchObject({ ok: true, value: { status: "CLOSED_LOST", provisionalCreditCents: 0 } });
    expect(await networkCallsFor(c.id)).toHaveLength(0);
    const row = await prisma.history.findFirstOrThrow({ where: { disputeId: c.id, action: "decision_approved" } });
    expect(JSON.parse(row.after ?? "{}")).toMatchObject({ networkMessage: null });
  });
});
