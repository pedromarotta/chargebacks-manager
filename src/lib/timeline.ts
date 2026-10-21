/** Backlog 8: the 8 lifecycle steps of BUSINESS_RULES §1, derived from the case and its history. */
export type StepState = "done" | "current" | "failed" | "skipped" | "upcoming";

export interface TimelineStep {
  n: number | null;
  title: string;
  owner: string;
  state: StepState;
  at: string | null;
  detail: string | null;
}

export interface TimelineCase {
  status: string;
  decisionType: string | null;
  openedAt: string;
  filingRejectedAt: string | null;
  filingRejectReason: string | null;
}

export interface TimelineEvent {
  action: string;
  at: string;
  after: Record<string, unknown> | null;
}

const STEPS = [
  { title: "Intake", owner: "Client, then analyst" },
  { title: "Validation", owner: "Analyst" },
  { title: "Filing", owner: "Analyst" },
  { title: "Evidence", owner: "Analyst" },
  { title: "Representment", owner: "Merchant" },
  { title: "Analysis", owner: "Analyst proposes, lead approves" },
  { title: "Pre-arbitration", owner: "Analyst" },
  { title: "Arbitration", owner: "Network" },
] as const;

const DECIDED = ["decision_executed", "decision_approved"];

export function buildTimeline(c: TimelineCase, history: readonly TimelineEvent[]): TimelineStep[] {
  const asc = [...history].sort((a, b) => a.at.localeCompare(b.at));
  const first = (pred: (e: TimelineEvent) => boolean) => asc.find(pred)?.at ?? null;
  const filedAt = first((e) => e.action === "chargeback_filed");
  const representedAt = first((e) => e.action === "representment_received");
  const decidedAt = first((e) => DECIDED.includes(e.action) && typeof e.after?.status === "string" && e.after.status !== "DECISION_PENDING");
  const rulingAt = first((e) => e.action === "ruling_recorded");
  const expiredAt = first((e) => e.after?.status === "EXPIRED");
  const lastEvidenceAt = [...asc].reverse().find((e) => e.action.startsWith("evidence_") && (!filedAt || e.at <= filedAt))?.at ?? null;

  const rejected = c.filingRejectedAt !== null;
  const filed = filedAt !== null || rejected || !["NEW", "EXPIRED"].includes(c.status);
  const escalated = c.decisionType === "ESCALATE_PRE_ARB" && ["PRE_ARB_FILED", "CLOSED_WON", "CLOSED_LOST"].includes(c.status);
  const acceptedLoss = !escalated && ["WRITTEN_OFF", "CLOSED_LOST"].includes(c.status);
  const wonWithoutAnswer = c.status === "CLOSED_WON" && !escalated;

  const steps: TimelineStep[] = STEPS.map((s, i) => ({ n: i + 1, ...s, state: "upcoming", at: null, detail: null }));
  const set = (n: number, state: StepState, at: string | null = null, detail: string | null = null) => {
    Object.assign(steps[n - 1], { state, at, detail });
  };

  set(1, "done", c.openedAt);
  if (filed) set(2, "done", filedAt);
  if (rejected) {
    set(3, "failed", c.filingRejectedAt, c.filingRejectReason ? `Network rejected the filing: ${c.filingRejectReason}` : "Network rejected the filing");
    for (const n of [4, 5, 6, 7, 8]) set(n, "skipped", null, "Doesn't apply after a rejected filing");
  } else {
    if (filed) set(3, "done", filedAt);
    if (filed) set(4, "done", lastEvidenceAt ?? filedAt, "Required evidence checked before filing");
    if (representedAt) set(5, "done", representedAt);
    else if (wonWithoutAnswer) set(5, "done", null, "The merchant didn't respond, so the issuer wins");
    if (decidedAt && (escalated || acceptedLoss)) set(6, "done", decidedAt);
    if (wonWithoutAnswer) for (const n of [6, 7, 8]) set(n, "skipped", null, "Not needed: the merchant didn't respond");
    if (acceptedLoss) for (const n of [7, 8]) set(n, "skipped", null, "Not needed: the loss was accepted");
    if (escalated) set(7, "done", decidedAt);
    if (escalated && c.status !== "PRE_ARB_FILED") set(8, "done", rulingAt, c.status === "CLOSED_WON" ? "Ruled in our favour" : "Ruled against us");
  }

  const open = steps.find((s) => s.state === "upcoming");
  if (c.status === "EXPIRED") {
    if (open) {
      open.state = "failed";
      open.at = expiredAt;
      open.detail = "The deadline passed, so the case expired";
      for (const s of steps) if (s.state === "upcoming") Object.assign(s, { state: "skipped", detail: "Doesn't apply after expiry" });
    }
  } else if (open) {
    open.state = "current";
    if (c.status === "DECISION_PENDING" && open.n === 6) open.detail = "Waiting for a lead's approval";
  }

  if (rejected) {
    const done = ["WRITTEN_OFF", "CLOSED_LOST"].includes(c.status);
    steps.push({
      n: null,
      title: "Ops review",
      owner: "Analyst proposes, lead approves",
      state: c.status === "EXPIRED" ? "failed" : done ? "done" : "current",
      at: done ? decidedAt : c.status === "EXPIRED" ? expiredAt : null,
      detail: done
        ? c.status === "WRITTEN_OFF" ? "Written off; the cardholder keeps the credit" : "Provisional credit reversed"
        : c.status === "DECISION_PENDING" ? "Waiting for a lead's approval" : c.status === "EXPIRED" ? "The deadline passed, so the case expired" : "Write it off or reverse the provisional credit",
    });
  }
  return steps;
}
