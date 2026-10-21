import { fundsInfo, PARKED_BUCKETS, type FundsInfo, type ParkedBucket } from "@/lib/funds";
import { prisma } from "../db";
import type { Actor } from "../domain";
import { ok, refusal, type Result } from "../errors";
import { can } from "../policy";
import { toDisputeView, type DisputeView } from "./view";

export interface FundsRow extends DisputeView {
  funds: FundsInfo;
}

export interface FundsBoard {
  rows: FundsRow[];
  buckets: Record<ParkedBucket, number>;
  parkedCents: number;
  alerts: number;
  overLimit: number;
  pendingApproval: number;
}

const ALERT_ORDER = { over_limit: 0, alert: 1, ok: 2, none: 3 } as const;

/** Backlog 9: read-only board of won cases whose funds are tracked. */
export async function getFundsBoard(actor: Actor | null, now = new Date()): Promise<Result<FundsBoard>> {
  if (!actor) return refusal("UNAUTHENTICATED");
  if (!can(actor, "dispute:read")) return refusal("ROLE_NOT_ALLOWED");
  const disputes = await prisma.dispute.findMany({ where: { status: "CLOSED_WON", fundsStatus: { not: null } } });
  const rows = disputes
    .map((d) => {
      const view = toDisputeView(d);
      return { ...view, funds: fundsInfo(view, now) };
    })
    .sort((a, b) => ALERT_ORDER[a.funds.alert] - ALERT_ORDER[b.funds.alert] || (b.funds.parkedHours ?? -1) - (a.funds.parkedHours ?? -1));
  const parked = rows.filter((r) => r.funds.parked);
  const buckets = Object.fromEntries(PARKED_BUCKETS.map((b) => [b.key, parked.filter((r) => r.funds.bucket === b.key).length])) as Record<ParkedBucket, number>;
  return ok({
    rows,
    buckets,
    parkedCents: parked.reduce((s, r) => s + r.amountCents, 0),
    alerts: rows.filter((r) => r.funds.alert === "alert").length,
    overLimit: rows.filter((r) => r.funds.alert === "over_limit").length,
    pendingApproval: rows.filter((r) => r.fundsPendingMove).length,
  });
}
