import { randomUUID } from "node:crypto";
import type { Tx } from "./db";
import type { NetworkMessage } from "./domain";

export { NETWORK } from "@/lib/network-config";

export interface SubmitInput {
  idempotencyKey: string;
  disputeId: string;
  message: NetworkMessage;
}

export interface SubmitResult {
  networkRef: string;
  replayed: boolean;
}

export function idempotencyKeyFor(disputeId: string, message: NetworkMessage): string {
  return `${disputeId}:${message}`;
}

/** Sends a message once per idempotency key; a repeated key returns the first result (R8). */
export async function submit(tx: Tx, input: SubmitInput): Promise<SubmitResult> {
  const existing = await tx.networkCall.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return { networkRef: existing.networkRef, replayed: true };

  const networkRef = `NA-${input.message}-${randomUUID().slice(0, 8).toUpperCase()}`;
  await tx.networkCall.create({
    data: {
      idempotencyKey: input.idempotencyKey,
      disputeId: input.disputeId,
      message: input.message,
      networkRef,
    },
  });
  return { networkRef, replayed: false };
}
