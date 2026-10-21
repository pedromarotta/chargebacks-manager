import { beforeAll, describe, expect, it } from "vitest";
import { approveDecision, fileChargeback, importDisputes, proposeDecision, rejectDecision, setEvidence } from "@/server/disputes/service";
import { prisma } from "@/server/db";
import { makeCase, seedDb, users } from "./helpers";

beforeAll(seedDb);

async function countHistory() {
  return prisma.history.count();
}

describe("R9 history", () => {
  it("every write leaves exactly one history row, and UPDATE or DELETE on history throws (R9)", async () => {
    const newCase = await makeCase({ status: "NEW", reasonCode: "DUPLICATE" });
    const big = await makeCase({ amountCents: 75000 });
    const big2 = await makeCase({ amountCents: 75000 });

    const writes: Array<() => Promise<{ ok: boolean }>> = [
      () => setEvidence(users.ana, newCase.id, { key: "statement", checked: true }),
      () => fileChargeback(users.ana, newCase.id),
      () => proposeDecision(users.ana, big.id, { decisionType: "ESCALATE_PRE_ARB", note: "Fight this one, weak evidence." }),
      () => approveDecision(users.ana, big.id, {}), // refused (R5)
      () => approveDecision(users.carla, big.id, {}),
      () => approveDecision(users.carla, big.id, {}), // refused (R7)
      () => proposeDecision(users.ben, big2.id, { decisionType: "ACCEPT_LOSS_WRITE_OFF", note: "Accepting the loss here." }),
      () => rejectDecision(users.eve, big2.id, { note: "Please escalate instead." }),
      () => importDisputes(users.dan, { csv: "a,b" }), // refused (R5)
      () => fileChargeback(users.ana, "CB-DOES-NOT-EXIST"), // refused (404)
    ];
    for (const write of writes) {
      const before = await countHistory();
      await write();
      expect(await countHistory()).toBe(before + 1);
    }

    await expect(prisma.$executeRawUnsafe(`UPDATE "History" SET note = 'x'`)).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "History"`)).rejects.toThrow(/append-only/);
    await expect(prisma.history.updateMany({ data: { note: "x" } })).rejects.toThrow();
  });
});
