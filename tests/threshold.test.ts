import { beforeAll, describe, expect, it } from "vitest";
import { proposeDecision } from "@/server/disputes/service";
import { prisma } from "@/server/db";
import { needsApproval } from "@/server/disputes/rules";
import { networkCallsFor, seedDb, users } from "./helpers";

beforeAll(seedDb);

describe("R3 threshold", () => {
  it("$499.99 executes when proposed; $500.00 waits for approval (R3)", async () => {
    const low = await proposeDecision(users.ana, "CB-1003", { decisionType: "ACCEPT_LOSS_WRITE_OFF", note: "Below handling cost, accept." });
    expect(low).toMatchObject({ ok: true, value: { status: "WRITTEN_OFF", decidedBy: "u_ana" } });
    expect((await networkCallsFor("CB-1003")).map((c) => c.message)).toContain("ACCEPT");

    const high = await proposeDecision(users.ana, "CB-1004", { decisionType: "ACCEPT_LOSS_WRITE_OFF", note: "Delivery signature is convincing." });
    expect(high).toMatchObject({ ok: true, value: { status: "DECISION_PENDING", proposedBy: "u_ana", decidedBy: null } });
    expect((await networkCallsFor("CB-1004")).map((c) => c.message)).toEqual(["CHARGEBACK"]);
  });

  it("uses the amount from the database, not the request (R3)", async () => {
    const c = await prisma.dispute.findUniqueOrThrow({ where: { id: "CB-1042" } });
    const r = await proposeDecision(users.ana, "CB-1042", {
      decisionType: "ACCEPT_LOSS_WRITE_OFF",
      note: "trying to sneak a low amount",
      amountCents: 100,
    } as never);
    expect(r).toMatchObject({ ok: true, value: { status: "DECISION_PENDING", amountCents: c.amountCents } });
  });

  it("currencies without a configured threshold always need approval (R3)", () => {
    expect(needsApproval(100, "EUR")).toBe(true);
    expect(needsApproval(49999, "USD")).toBe(false);
  });
});
