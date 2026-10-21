import { beforeAll, describe, expect, it } from "vitest";
import { draftPreArbMemo } from "@/lib/pre-arb-memo";
import { prisma } from "@/server/db";
import { approveDecision, editMemo, proposeDecision, rejectDecision } from "@/server/disputes/service";
import { makeCase, seedDb, users } from "./helpers";

beforeAll(seedDb);

const facts = { id: "CB-1", merchant: "Acme", amount: "$900.00", cardLast4: "4417", reasonCode: "NOT_RECEIVED", merchantResponse: "Shipped." };
const NOTE = "Merchant evidence is weak.";

describe("pre-arbitration memo (backlog 3)", () => {
  it("drafts per reason code and adapts to the merchant type (no shipping for digital)", () => {
    expect(draftPreArbMemo(facts, "PHYSICAL_GOODS")).toMatch(/proof of delivery/);
    const digital = draftPreArbMemo({ ...facts, merchantResponse: "Access logs attached." }, "DIGITAL_SERVICE");
    expect(digital).not.toMatch(/deliver|ship/i);
    expect(digital).toMatch(/accessed or downloaded/);
    expect(draftPreArbMemo({ ...facts, reasonCode: "FRAUD" }, "DIGITAL_SERVICE")).not.toMatch(/goods/);
    expect(draftPreArbMemo({ ...facts, reasonCode: "DUPLICATE" }, "PHYSICAL_GOODS")).toMatch(/charged more than once/);
    expect(draftPreArbMemo(facts, "PHYSICAL_GOODS")).toContain("Card ending 4417");
  });

  it("saves the edited memo with the escalation; uses the template when none is sent", async () => {
    const a = await makeCase({ status: "REPRESENTMENT_RECEIVED", amountCents: 90000 });
    const r = await proposeDecision(users.ana, a.id, { decisionType: "ESCALATE_PRE_ARB", note: NOTE, merchantType: "DIGITAL_SERVICE", memo: "  Custom memo text for the network.  " });
    expect(r).toMatchObject({ ok: true, value: { preArbMemo: "Custom memo text for the network.", merchantType: "DIGITAL_SERVICE" } });

    const b = await makeCase({ status: "REPRESENTMENT_RECEIVED", amountCents: 90000 });
    const r2 = await proposeDecision(users.ana, b.id, { decisionType: "ESCALATE_PRE_ARB", note: NOTE });
    expect(r2.ok && r2.value.preArbMemo).toContain(`Pre-arbitration: case ${b.id}`);

    const c = await makeCase({ status: "REPRESENTMENT_RECEIVED", amountCents: 90000 });
    const r3 = await proposeDecision(users.ana, c.id, { decisionType: "ACCEPT_LOSS_WRITE_OFF", note: NOTE, memo: "ignored for accept" });
    expect(r3).toMatchObject({ ok: true, value: { preArbMemo: null } });
  });

  it("refuses a memo with a full card number or too short", async () => {
    const a = await makeCase({ status: "REPRESENTMENT_RECEIVED", amountCents: 90000 });
    expect(await proposeDecision(users.ana, a.id, { decisionType: "ESCALATE_PRE_ARB", note: NOTE, memo: "Card 4111111111111111 was used." })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await proposeDecision(users.ana, a.id, { decisionType: "ESCALATE_PRE_ARB", note: NOTE, memo: "short" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect((await prisma.dispute.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("REPRESENTMENT_RECEIVED");
  });

  it("only the proposer edits it, only while pending; edits are in history; approval keeps the final text", async () => {
    const a = await makeCase({ status: "REPRESENTMENT_RECEIVED", amountCents: 90000 });
    await proposeDecision(users.carla, a.id, { decisionType: "ESCALATE_PRE_ARB", note: NOTE, memo: "First draft of the memo." });
    expect(await editMemo(users.eve, a.id, { memo: "Approver rewrites the memo." })).toMatchObject({ ok: false, code: "ROLE_NOT_ALLOWED" });
    expect(await editMemo(users.dan, a.id, { memo: "Auditor rewrites the memo." })).toMatchObject({ ok: false, code: "ROLE_NOT_ALLOWED" });
    expect(await editMemo(users.carla, a.id, { memo: "Second draft of the memo." })).toMatchObject({ ok: true, value: { preArbMemo: "Second draft of the memo." } });
    const edit = await prisma.history.findFirstOrThrow({ where: { disputeId: a.id, action: "memo_edited" } });
    expect(edit.before).toContain("First draft");
    expect(edit.after).toContain("Second draft");

    expect(await approveDecision(users.eve, a.id, {})).toMatchObject({ ok: true, value: { status: "PRE_ARB_FILED", preArbMemo: "Second draft of the memo." } });
    expect(await editMemo(users.carla, a.id, { memo: "Too late to change this." })).toMatchObject({ ok: false, code: "INVALID_STATUS" });
  });

  it("rejection clears the memo for the next proposal", async () => {
    const a = await makeCase({ status: "REPRESENTMENT_RECEIVED", amountCents: 90000 });
    await proposeDecision(users.ana, a.id, { decisionType: "ESCALATE_PRE_ARB", note: NOTE, memo: "Memo that gets rejected." });
    expect(await rejectDecision(users.carla, a.id, { note: "Not enough evidence to fight." })).toMatchObject({ ok: true, value: { preArbMemo: null, merchantType: null } });
  });
});
