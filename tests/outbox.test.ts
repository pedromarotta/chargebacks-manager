import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { fileChargeback, proposeDecision } from "@/server/disputes/service";
import { deliverOutbox, idempotencyKeyFor, injectNetworkFaults } from "@/server/network";
import { makeCase, networkCallsFor, seedDb, users } from "./helpers";

beforeAll(seedDb);
afterEach(() => injectNetworkFaults());

const outboxFor = (id: string) => prisma.outboxMessage.findUniqueOrThrow({ where: { idempotencyKey: idempotencyKeyFor(id, "CHARGEBACK") } });
const newCase = () => makeCase({ status: "NEW", evidenceChecked: true });

describe("network outbox (backlog 10)", () => {
  it("writes the outbox row in the transaction and sends it after commit", async () => {
    const c = await newCase();
    expect(await fileChargeback(users.ana, c.id)).toMatchObject({ ok: true });
    const [call] = await networkCallsFor(c.id);
    expect(await outboxFor(c.id)).toMatchObject({ status: "SENT", attempts: 1, networkRef: call.networkRef });
    expect((await prisma.dispute.findUniqueOrThrow({ where: { id: c.id } })).networkRef).toBe(call.networkRef);
  });

  it("a timeout after the network recorded the call, then a retry: exactly one record on the network side", async () => {
    const c = await newCase();
    injectNetworkFaults("timeout_after");
    expect(await fileChargeback(users.ana, c.id)).toMatchObject({ ok: true, value: { status: "CHARGEBACK_FILED" } });
    expect(await outboxFor(c.id)).toMatchObject({ status: "PENDING", attempts: 1, lastError: expect.stringMatching(/did not answer/) });
    expect(await networkCallsFor(c.id)).toHaveLength(1);

    expect(await deliverOutbox()).toMatchObject({ sent: 1, failed: 0 });
    const calls = await networkCallsFor(c.id);
    expect(calls).toHaveLength(1);
    expect(await outboxFor(c.id)).toMatchObject({ status: "SENT", attempts: 2, networkRef: calls[0].networkRef });
    expect(await deliverOutbox()).toMatchObject({ sent: 0 });
    expect(await networkCallsFor(c.id)).toHaveLength(1);
  });

  it("a timeout before the network saw it: the business change still commits and the retry sends once", async () => {
    const c = await newCase();
    injectNetworkFaults("timeout_before");
    await fileChargeback(users.ana, c.id);
    expect((await prisma.dispute.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("CHARGEBACK_FILED");
    expect(await networkCallsFor(c.id)).toHaveLength(0);
    await deliverOutbox();
    expect(await networkCallsFor(c.id)).toHaveLength(1);
  });

  it("concurrent retries still produce one network record", async () => {
    const c = await newCase();
    injectNetworkFaults("timeout_after");
    await fileChargeback(users.ana, c.id);
    await Promise.all([deliverOutbox(), deliverOutbox(), deliverOutbox()]);
    expect(await networkCallsFor(c.id)).toHaveLength(1);
    expect(await outboxFor(c.id)).toMatchObject({ status: "SENT" });
  });

  it("a refused write leaves no outbox row and calls nothing", async () => {
    const c = await makeCase({ status: "REPRESENTMENT_RECEIVED", amountCents: 10000 });
    expect(await proposeDecision(users.ana, c.id, { decisionType: "ACCEPT_LOSS_WRITE_OFF", note: "short" })).toMatchObject({ ok: false });
    expect(await prisma.outboxMessage.count({ where: { disputeId: c.id } })).toBe(0);
    expect(await networkCallsFor(c.id)).toHaveLength(0);
  });
});
