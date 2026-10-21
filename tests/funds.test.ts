import { beforeAll, describe, expect, it } from "vitest";
import { fundsInfo } from "@/lib/funds";
import { prisma } from "@/server/db";
import { getFundsBoard } from "@/server/disputes/funds-board";
import { NETWORK_ACTOR, approveFundsMove, creditProgram, proposeFundsMove, recordFundsReceived, recordRuling, rejectFundsMove } from "@/server/disputes/service";
import { makeCase, seedDb, users } from "./helpers";

beforeAll(seedDb);

async function wonCase(credit = 0) {
  const c = await makeCase({ status: "PRE_ARB_FILED", decisionType: "ESCALATE_PRE_ARB", provisionalCreditCents: credit, amountCents: 90000 });
  const r = await recordRuling(NETWORK_ACTOR, c.id, { outcome: "WON" });
  expect(r.ok).toBe(true);
  return c.id;
}
const fundsOf = async (id: string) => (await prisma.dispute.findUniqueOrThrow({ where: { id } })).fundsStatus;

describe("funds tracking (backlog 9)", () => {
  it("only tracks won cases without a provisional credit", async () => {
    expect(await fundsOf(await wonCase(0))).toBe("FUNDS_NOT_YET_RECEIVED");
    const withCredit = await wonCase(90000);
    expect(await fundsOf(withCredit)).toBeNull();
    expect(await recordFundsReceived(NETWORK_ACTOR, withCredit)).toMatchObject({ ok: false, code: "INVALID_STATUS" });
  });

  it("receive → program → credit cardholder, with maker-checker on the money move", async () => {
    const id = await wonCase();
    expect(await recordFundsReceived(users.ana, id)).toMatchObject({ ok: false, code: "ROLE_NOT_ALLOWED" });
    expect(await recordFundsReceived(NETWORK_ACTOR, id)).toMatchObject({ ok: true, value: { fundsStatus: "FUNDS_RECEIVED_FROM_ACQUIRER" } });
    expect(await proposeFundsMove(users.ana, id, { move: "CREDIT_CARDHOLDER", note: "Pay the cardholder now." })).toMatchObject({ ok: false, code: "INVALID_STATUS" });
    expect(await creditProgram(users.dan, id)).toMatchObject({ ok: false, code: "ROLE_NOT_ALLOWED" });
    expect(await creditProgram(users.ana, id)).toMatchObject({ ok: true, value: { fundsStatus: "FUNDS_CREDITED_TO_PROGRAM" } });
    expect(await proposeFundsMove(users.carla, id, { move: "CREDIT_CARDHOLDER", note: "short" })).toMatchObject({ ok: false, code: "NOTE_TOO_SHORT" });
    expect(await proposeFundsMove(users.carla, id, { move: "CREDIT_CARDHOLDER", note: "Won at arbitration, pay the cardholder." })).toMatchObject({ ok: true, value: { fundsPendingMove: "CREDIT_CARDHOLDER" } });
    expect(await approveFundsMove(users.ana, id, {})).toMatchObject({ ok: false, code: "ROLE_NOT_ALLOWED" });
    expect(await approveFundsMove(users.carla, id, {})).toMatchObject({ ok: false, code: "SELF_APPROVAL_BLOCKED" });
    expect(await prisma.history.count({ where: { disputeId: id, action: "decision_blocked" } })).toBe(1);
    expect(await approveFundsMove(users.eve, id, { comment: "ok" })).toMatchObject({ ok: true, value: { fundsStatus: "FUNDS_CREDITED_TO_CARDHOLDER", fundsPendingMove: null } });
    expect(await approveFundsMove(users.eve, id, {})).toMatchObject({ ok: false, code: "INVALID_STATUS" });
    const actions = (await prisma.history.findMany({ where: { disputeId: id }, orderBy: { id: "asc" } })).map((h) => h.action);
    expect(actions).toEqual(expect.arrayContaining(["funds_received", "funds_credited_to_program", "funds_move_proposed", "funds_move_approved"]));
  });

  it("reversal can be rejected, then re-proposed and approved", async () => {
    const id = await wonCase();
    await recordFundsReceived(NETWORK_ACTOR, id);
    await proposeFundsMove(users.ana, id, { move: "REVERSE", note: "Acquirer asked for the funds back." });
    expect(await proposeFundsMove(users.ben, id, { move: "REVERSE", note: "Duplicate proposal here." })).toMatchObject({ ok: false, code: "INVALID_STATUS" });
    expect(await rejectFundsMove(users.eve, id, { note: "no" })).toMatchObject({ ok: false, code: "NOTE_TOO_SHORT" });
    expect(await rejectFundsMove(users.eve, id, { note: "Not confirmed by the acquirer yet." })).toMatchObject({ ok: true, value: { fundsPendingMove: null, fundsStatus: "FUNDS_RECEIVED_FROM_ACQUIRER" } });
    await proposeFundsMove(users.ana, id, { move: "REVERSE", note: "Acquirer confirmed the reversal." });
    expect(await approveFundsMove(users.carla, id, {})).toMatchObject({ ok: true, value: { fundsStatus: "FUNDS_REVERSED" } });
  });

  it("parked time, buckets and jurisdiction alerts", () => {
    const now = new Date("2026-10-21T12:00:00Z");
    const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
    const v = (h: number, fundsStatus = "FUNDS_CREDITED_TO_PROGRAM", jurisdiction = "BR") => ({ fundsStatus, fundsReceivedAt: ago(h), fundsSettledAt: null, jurisdiction });
    expect(fundsInfo(v(20), now)).toMatchObject({ parked: true, bucket: "under_24h", alert: "ok", limitHours: 168, alertAtHours: 144 });
    expect(fundsInfo(v(50), now)).toMatchObject({ bucket: "1_3d", alert: "ok" });
    expect(fundsInfo(v(150), now)).toMatchObject({ bucket: "3_7d", alert: "alert" });
    expect(fundsInfo(v(170), now)).toMatchObject({ bucket: "over_limit", alert: "over_limit" });
    expect(fundsInfo(v(170, "FUNDS_CREDITED_TO_PROGRAM", "MX"), now)).toMatchObject({ bucket: "over_7d", alert: "ok" });
    expect(fundsInfo({ ...v(170), fundsStatus: "FUNDS_CREDITED_TO_CARDHOLDER", fundsSettledAt: ago(10) }, now)).toMatchObject({ parked: false, alert: "none", parkedHours: 160 });
  });

  it("board is readable by every role and needs a session", async () => {
    const r = await getFundsBoard(users.dan);
    expect(r.ok).toBe(true);
    expect(await getFundsBoard(null)).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });
});
