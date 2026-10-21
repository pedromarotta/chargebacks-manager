import { followsRecommendation } from "@/lib/fight-or-accept";
import { prisma } from "../db";
import type { Actor } from "../domain";
import { ok, refusal, type Result } from "../errors";
import { can } from "../policy";
import { isAtRiskOfTimeout, isOpen } from "./rules";

export interface MetricsInput {
  status: string;
  amountCents: number;
  provisionalCreditCents: number;
  dueAt: Date;
  decisionType: string | null;
  decidedBy: string | null;
  recommendation: string | null;
}

export const DAYS_LEFT_BUCKETS = [
  { key: "breached", label: "Past due", maxHours: 0 },
  { key: "d1", label: "≤ 1 day", maxHours: 24 },
  { key: "d3", label: "1–3 days", maxHours: 72 },
  { key: "d7", label: "3–7 days", maxHours: 168 },
  { key: "d14", label: "7–14 days", maxHours: 336 },
  { key: "later", label: "> 14 days", maxHours: Infinity },
] as const;

export interface Metrics {
  open: { count: number; amountCents: number };
  byDaysLeft: { key: string; label: string; count: number; amountCents: number }[];
  atRisk: { count: number; amountCents: number };
  provisionalOutstandingCents: number;
  closed: { total: number; won: number; lost: number; writtenOff: number; expired: number; winRate: number | null };
  recommendation: { decided: number; matched: number; rate: number | null };
}

/** Pure, so every number on /metrics can be tested and explained. Amounts are USD (the import rejects other currencies). */
export function computeMetrics(disputes: readonly MetricsInput[], now: Date): Metrics {
  const open = disputes.filter((d) => isOpen(d.status));
  const byDaysLeft = DAYS_LEFT_BUCKETS.map((b) => ({ key: b.key, label: b.label, count: 0, amountCents: 0 }));
  for (const d of open) {
    const hoursLeft = (d.dueAt.getTime() - now.getTime()) / 3_600_000;
    const i = hoursLeft <= 0 ? 0 : DAYS_LEFT_BUCKETS.findIndex((b) => b.maxHours > 0 && hoursLeft <= b.maxHours);
    byDaysLeft[i].count += 1;
    byDaysLeft[i].amountCents += d.amountCents;
  }
  const atRisk = open.filter((d) => isAtRiskOfTimeout(d.status, d.dueAt, now));

  const count = (s: string) => disputes.filter((d) => d.status === s).length;
  const won = count("CLOSED_WON");
  const lost = count("CLOSED_LOST");
  const writtenOff = count("WRITTEN_OFF");
  const expired = count("EXPIRED");
  const total = won + lost + writtenOff + expired;

  const decided = disputes.filter((d) => d.decidedBy && d.decisionType && d.recommendation);
  const matched = decided.filter((d) => followsRecommendation(d.decisionType!, d.recommendation!)).length;

  return {
    open: { count: open.length, amountCents: sum(open, "amountCents") },
    byDaysLeft,
    atRisk: { count: atRisk.length, amountCents: sum(atRisk, "amountCents") },
    provisionalOutstandingCents: sum(open, "provisionalCreditCents"),
    closed: { total, won, lost, writtenOff, expired, winRate: total ? won / total : null },
    recommendation: { decided: decided.length, matched, rate: decided.length ? matched / decided.length : null },
  };
}

function sum<T>(rows: readonly T[], key: { [K in keyof T]: T[K] extends number ? K : never }[keyof T]): number {
  return rows.reduce((acc, r) => acc + (r[key] as number), 0);
}

export async function getMetrics(actor: Actor | null, now = new Date()): Promise<Result<Metrics>> {
  if (!actor) return refusal("UNAUTHENTICATED");
  if (!can(actor, "dispute:read")) return refusal("ROLE_NOT_ALLOWED");
  return ok(computeMetrics(await prisma.dispute.findMany(), now));
}
