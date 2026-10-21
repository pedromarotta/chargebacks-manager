import { historyChanges, historyTitle } from "@/lib/format";
import { prisma } from "./db";
import { getQueue, listHistory, type HistoryFilter, type QueueTab } from "./disputes/queries";
import { ok, refusal, type Result } from "./errors";
import { record } from "./history";
import { redactCardNumbers } from "./import";
import type { Actor } from "./domain";
import { can } from "./policy";

/** Backlog 5: CSV export of the queue and the history, for auditors. */
export interface CsvExport {
  filename: string;
  csv: string;
  rows: number;
}

const FORMULA_START = /^[=+\-@\t\r]/;

/** RFC 4180 quoting, a leading quote on spreadsheet formulas, and a last-resort card-number redaction. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  s = redactCardNumbers(s);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: readonly string[], rows: readonly unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function centsToDecimal(cents: number | null): string {
  if (cents === null) return "";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const stamp = (now: Date) => now.toISOString().slice(0, 10);

async function logExport(actor: Actor, kind: string, rows: number, filters: Record<string, unknown>) {
  await prisma.$transaction((tx) => record(tx, { actor, action: "data_exported", disputeId: null, before: null, after: { kind, rows, filters }, note: null }));
}

export const QUEUE_COLUMNS = [
  "case_id", "client", "card_last4", "merchant", "amount", "currency", "reason_code", "status",
  "opened_at", "due_at", "due_risk", "provisional_credit", "decision_type", "proposed_by", "decided_by",
  "decided_at", "p_win_pct", "recommendation",
] as const;

export async function exportQueue(
  actor: Actor | null,
  filters: { tab?: QueueTab; client?: string | null },
  now = new Date(),
): Promise<Result<CsvExport>> {
  if (!actor) return refusal("UNAUTHENTICATED");
  if (!can(actor, "export")) return refusal("ROLE_NOT_ALLOWED");
  const q = await getQueue(actor, filters, now);
  if (!q.ok) return q;
  const rows = q.value.rows.map((d) => [
    d.id, d.client, d.cardLast4, d.merchant, centsToDecimal(d.amountCents), d.currency, d.reasonCode, d.status,
    d.openedAt, d.dueAt, d.risk ?? "", centsToDecimal(d.provisionalCreditCents), d.decisionType, d.proposedBy,
    d.decidedBy, d.decidedAt, d.pWinPct, d.recommendation,
  ]);
  await logExport(actor, "queue", rows.length, { tab: filters.tab ?? "all", client: filters.client ?? null });
  return ok({ filename: `disputes-queue-${stamp(now)}.csv`, csv: toCsv(QUEUE_COLUMNS, rows), rows: rows.length });
}

export const HISTORY_COLUMNS = ["id", "at", "actor_id", "actor_role", "action", "case_id", "summary", "changes", "note", "before", "after"] as const;

export async function exportHistory(
  actor: Actor | null,
  filters: { kind?: HistoryFilter; actorId?: string | null; disputeId?: string | null },
  now = new Date(),
): Promise<Result<CsvExport>> {
  if (!actor) return refusal("UNAUTHENTICATED");
  if (!can(actor, "export")) return refusal("ROLE_NOT_ALLOWED");
  const h = await listHistory(actor, filters, null);
  if (!h.ok) return h;
  const rows = h.value.map((e) => [
    e.id, e.at, e.actorId, e.actorRole, e.action, e.disputeId, historyTitle(e), historyChanges(e).join(" | "), e.note, e.before, e.after,
  ]);
  await logExport(actor, "history", rows.length, { kind: filters.kind ?? "all", actor: filters.actorId ?? null, case: filters.disputeId ?? null });
  return ok({ filename: `history-${stamp(now)}.csv`, csv: toCsv(HISTORY_COLUMNS, rows), rows: rows.length });
}
