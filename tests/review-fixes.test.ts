import { beforeAll, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/session/route";
import { prisma } from "@/server/db";
import { sessionCookieOptions } from "@/server/auth";
import { approveDecision, approveFundsMove, importDisputes, rejectDecision } from "@/server/disputes/service";
import { RESPONSE_WINDOW_DAYS } from "@/server/disputes/rules";
import { EXPECTED_COLUMNS, MAX_AMOUNT_CENTS, parseAmountToCents, parseUtcDate } from "@/server/import";
import { makeCase, seedDb, users } from "./helpers";

beforeAll(seedDb);

type Row = Partial<Record<(typeof EXPECTED_COLUMNS)[number], string>>;
let n = 0;
function row(over: Row = {}): Row {
  n += 1;
  return {
    case_id: `RF-${Date.now().toString(36)}-${n}`,
    client: "Norte Bank",
    card_last4: "4242",
    merchant: "Amazon",
    amount: "25.00",
    currency: "USD",
    reason_code: "FRAUD",
    opened_at: "2026-10-01",
    due_at: "2030-01-15",
    merchant_response: "",
    ...over,
  };
}
const csv = (...rows: Row[]) =>
  [EXPECTED_COLUMNS.join(","), ...rows.map((r) => EXPECTED_COLUMNS.map((c) => r[c] ?? "").join(","))].join("\n");

describe("(a) merchant responses for existing cases in the daily file", () => {
  it("records the representment on a filed case instead of dropping it as a duplicate", async () => {
    const filed = await makeCase({ status: "CHARGEBACK_FILED" });
    await prisma.dispute.update({ where: { id: filed.id }, data: { merchantResponse: null } });
    const file = csv(row({ case_id: filed.id, merchant_response: "Order delivered with signature" }));
    const now = new Date();

    const preview = await importDisputes(users.ana, { csv: file, dryRun: true }, now);
    expect(preview).toMatchObject({ ok: true, value: { representments: 1, duplicates: 0, rows: [{ result: "REPRESENTMENT" }] } });
    expect((await prisma.dispute.findUniqueOrThrow({ where: { id: filed.id } })).status).toBe("CHARGEBACK_FILED");

    const r = await importDisputes(users.ana, { csv: file }, now);
    expect(r).toMatchObject({ ok: true, value: { imported: 0, duplicates: 0, representments: 1 } });
    const d = await prisma.dispute.findUniqueOrThrow({ where: { id: filed.id } });
    expect(d).toMatchObject({ status: "REPRESENTMENT_RECEIVED", merchantResponse: "Order delivered with signature" });
    expect(d.dueAt.getTime()).toBe(now.getTime() + RESPONSE_WINDOW_DAYS * 86_400_000);
    const h = await prisma.history.findFirstOrThrow({ where: { disputeId: filed.id, action: "representment_received" } });
    expect(h).toMatchObject({ actorId: "u_ana", note: "Order delivered with signature" });
    expect(await prisma.importBatch.findFirstOrThrow({ where: { id: (r.ok && r.value.batchId) || "" } })).toMatchObject({ representments: 1 });

    const again = await importDisputes(users.ana, { csv: file });
    expect(again).toMatchObject({ ok: true, value: { duplicates: 1, representments: 0 } });
  });

  it("other existing cases stay duplicates, and a past-due filed case is rejected", async () => {
    const fresh = await makeCase({ status: "NEW" });
    const late = await makeCase({ status: "CHARGEBACK_FILED", dueInDays: -1 });
    const r = await importDisputes(users.ana, {
      csv: csv(row({ case_id: fresh.id, merchant_response: "Merchant answer" }), row({ case_id: late.id, merchant_response: "Too late answer" })),
    });
    expect(r).toMatchObject({ ok: true, value: { duplicates: 1, rejected: 1, representments: 0 } });
    if (r.ok) expect(r.value.rows[1]).toMatchObject({ result: "REJECTED", reasons: ["case is past its network deadline"] });
    expect((await prisma.dispute.findUniqueOrThrow({ where: { id: late.id } })).status).toBe("CHARGEBACK_FILED");
  });
});

describe("(b) amounts too large for the database column", () => {
  it("rejects the row and imports the rest of the batch", async () => {
    expect(parseAmountToCents("21474836.47")).toBe(MAX_AMOUNT_CENTS);
    expect(parseAmountToCents("21474836.48")).toBeNull();
    const big = row({ amount: "21474836.48" });
    const ok = row();
    const r = await importDisputes(users.ana, { csv: csv(big, ok) });
    expect(r).toMatchObject({ ok: true, value: { imported: 1, rejected: 1 } });
    if (r.ok) expect(r.value.rows[0]).toMatchObject({ result: "REJECTED", reasons: ["amount is too large"] });
    expect(await prisma.dispute.count({ where: { id: ok.case_id } })).toBe(1);
  });
});

describe("(c) impossible dates", () => {
  it.each(["2026-02-30", "2026-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "2026-01-01T25:00:00Z", "2026-01-01T10:60Z", "2026-01-01T10:00:00+15:00"])(
    "rejects %s",
    (raw) => expect(parseUtcDate(raw, "end")).toBeNull(),
  );
  it("accepts real dates, including leap days", () => {
    expect(parseUtcDate("2028-02-29", "end")?.toISOString()).toBe("2028-02-29T23:59:59.000Z");
    expect(parseUtcDate("2026-03-01T10:00:00-03:00", "end")?.toISOString()).toBe("2026-03-01T13:00:00.000Z");
  });
  it("an import row with due_at 2026-02-30 is rejected", async () => {
    const r = await importDisputes(users.ana, { csv: csv(row({ due_at: "2026-02-30" })), dryRun: true });
    expect(r).toMatchObject({ ok: true, value: { rejected: 1, rows: [{ reasons: ["invalid due_at"] }] } });
  });
});

describe("(d) Secure session cookie outside localhost", () => {
  it("is Secure everywhere except plain-HTTP localhost", () => {
    expect(sessionCookieOptions("http://localhost:3000/api/session").secure).toBe(false);
    expect(sessionCookieOptions("http://127.0.0.1:3000/api/session").secure).toBe(false);
    expect(sessionCookieOptions("http://disputes.internal/api/session").secure).toBe(true);
    expect(sessionCookieOptions("https://localhost:3000/api/session").secure).toBe(true);
    expect(sessionCookieOptions("http://localhost:3000/api/session", "https").secure).toBe(true);
  });
  it("the login route sets the flag", async () => {
    const send = (url: string, extra: Record<string, string> = {}) =>
      login(
        new Request(url, {
          method: "POST",
          headers: { "content-type": "application/json", ...extra },
          body: JSON.stringify({ userId: "u_ana" }),
        }),
      );
    expect((await send("http://disputes.internal/api/session")).headers.get("set-cookie")).toMatch(/;\s*Secure/i);
    expect((await send("http://localhost:3000/api/session", { "x-forwarded-host": "disputes.internal" })).headers.get("set-cookie")).toMatch(/;\s*Secure/i);
    expect((await send("http://localhost:3000/api/session")).headers.get("set-cookie")).not.toMatch(/Secure/i);
  });
});

describe("role refusal wording", () => {
  it("an analyst approving or rejecting is told only a lead can", async () => {
    const c = await makeCase({ status: "DECISION_PENDING", decisionType: "ACCEPT_LOSS_WRITE_OFF", proposedBy: "u_ben", amountCents: 90000 });
    expect(await approveDecision(users.ana, c.id, {})).toMatchObject({ ok: false, code: "ROLE_NOT_ALLOWED", httpStatus: 403, message: "Only a lead can approve this decision." });
    expect(await rejectDecision(users.ana, c.id, { note: "Analyst tries to reject" })).toMatchObject({ message: "Only a lead can reject this decision." });
    expect(await approveFundsMove(users.ana, c.id, {})).toMatchObject({ message: "Only a lead can approve this funds move." });
    const h = await prisma.history.findFirstOrThrow({ where: { disputeId: c.id, action: "action_refused" }, orderBy: { id: "asc" } });
    expect(JSON.parse(h.after ?? "{}")).toMatchObject({ reason: "Only a lead can approve this decision." });
  });
});
