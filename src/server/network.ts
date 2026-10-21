import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma, type Tx } from "./db";
import type { NetworkMessage } from "./domain";

export { NETWORK } from "@/lib/network-config";

export interface OutboxInput {
  idempotencyKey: string;
  disputeId: string;
  message: NetworkMessage;
}

export interface EnqueueResult {
  idempotencyKey: string;
  queued: boolean;
}

export function idempotencyKeyFor(disputeId: string, message: NetworkMessage): string {
  return `${disputeId}:${message}`;
}

/**
 * Backlog 10, inside the business transaction: write an outbox row, never call the network.
 * The same key is only queued once (R8).
 */
export async function enqueue(tx: Tx, input: OutboxInput): Promise<EnqueueResult> {
  const existing = await tx.outboxMessage.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return { idempotencyKey: existing.idempotencyKey, queued: false };
  await tx.outboxMessage.create({ data: { ...input } });
  return { idempotencyKey: input.idempotencyKey, queued: true };
}

/* ---- Simulated network (the remote side). NetworkCall is the network's own record, keyed by idempotency key. ---- */

export class NetworkTimeout extends Error {}

/** Test hook: "before" times out before the network sees the request; "after" loses the response once it has recorded it. */
export type NetworkFault = "timeout_before" | "timeout_after";
let faults: NetworkFault[] = [];
export function injectNetworkFaults(...next: NetworkFault[]): void {
  faults = next;
}

async function networkReceive(input: OutboxInput): Promise<string> {
  const fault = faults.shift();
  if (fault === "timeout_before") throw new NetworkTimeout("The network did not answer in time.");
  let call = await prisma.networkCall.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (!call) {
    try {
      call = await prisma.networkCall.create({
        data: { ...input, networkRef: `NA-${input.message}-${randomUUID().slice(0, 8).toUpperCase()}` },
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      call = await prisma.networkCall.findUniqueOrThrow({ where: { idempotencyKey: input.idempotencyKey } });
    }
  }
  if (fault === "timeout_after") throw new NetworkTimeout("The network did not answer in time.");
  return call.networkRef;
}

/**
 * After commit: send every pending outbox row with its idempotency key. A timeout leaves the row
 * pending for the next run; the network dedupes by key, so a retry never creates a second record.
 */
export async function deliverOutbox(): Promise<{ sent: number; failed: number }> {
  const pending = await prisma.outboxMessage.findMany({ where: { status: "PENDING" }, orderBy: { id: "asc" } });
  let sent = 0;
  let failed = 0;
  for (const m of pending) {
    const input = { idempotencyKey: m.idempotencyKey, disputeId: m.disputeId, message: m.message as NetworkMessage };
    try {
      const networkRef = await networkReceive(input);
      const marked = await prisma.outboxMessage.updateMany({
        where: { id: m.id, status: "PENDING" },
        data: { status: "SENT", networkRef, sentAt: new Date(), attempts: { increment: 1 }, lastError: null },
      });
      if (marked.count === 1 && m.message === "CHARGEBACK") {
        await prisma.dispute.update({ where: { id: m.disputeId }, data: { networkRef } });
      }
      sent += marked.count;
    } catch (e) {
      failed += 1;
      await prisma.outboxMessage.updateMany({
        where: { id: m.id, status: "PENDING" },
        data: { attempts: { increment: 1 }, lastError: e instanceof Error ? e.message.slice(0, 200) : "Unknown error" },
      });
    }
  }
  return { sent, failed };
}
