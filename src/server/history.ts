import { redactCardNumbers } from "./import";
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
  "memo_edited",
  "data_exported",
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

function scrub(value: unknown): unknown {
  if (typeof value === "string") return redactCardNumbers(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v)]));
  }
  return value;
}

/** Backlog 6: a full card number never reaches History, even if a caller forgets to refuse it. */
function toJson(value: Record<string, unknown> | null | undefined): string | null {
  return value ? JSON.stringify(scrub(value)) : null;
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
      note: event.note == null ? null : redactCardNumbers(event.note),
    },
  });
}
