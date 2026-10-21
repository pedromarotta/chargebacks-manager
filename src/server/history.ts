import type { Tx } from "./db";
import type { Actor } from "./domain";

export const HISTORY_ACTIONS = [
  "import_batch",
  "evidence_checked",
  "evidence_unchecked",
  "evidence_file_attached",
  "chargeback_filed",
  "representment_received",
  "decision_proposed",
  "decision_executed",
  "decision_approved",
  "decision_rejected",
  "decision_blocked",
  "action_refused",
  "ruling_recorded",
] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

export interface HistoryEvent {
  actor: Actor;
  action: HistoryAction;
  disputeId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  note?: string | null;
  at?: Date;
}

function toJson(value: Record<string, unknown> | null | undefined): string | null {
  return value ? JSON.stringify(value) : null;
}

/** The only code that writes to History. Always called inside the business transaction (R9). */
export async function record(tx: Tx, event: HistoryEvent): Promise<void> {
  await tx.history.create({
    data: {
      at: event.at ?? new Date(),
      actorId: event.actor.id,
      actorRole: event.actor.role,
      action: event.action,
      disputeId: event.disputeId ?? null,
      before: toJson(event.before),
      after: toJson(event.after),
      note: event.note ?? null,
    },
  });
}
