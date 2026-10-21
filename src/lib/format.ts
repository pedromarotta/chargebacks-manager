/** Display helpers shared by server and client components. All times render in UTC. */

export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(cents / 100);
}

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatDateTime(iso: string): string {
  return `${DATE_TIME.format(new Date(iso))} UTC`;
}

/** "3d 4h", "5h 12m", or "overdue 2d". */
export function formatDueIn(iso: string, now: Date): string {
  const ms = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(ms);
  const minutes = Math.floor(abs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const text = days > 0 ? `${days}d ${hours % 24}h` : hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
  return ms < 0 ? `overdue ${text}` : text;
}

export const STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  CHARGEBACK_FILED: "Chargeback filed",
  REPRESENTMENT_RECEIVED: "Representment received",
  DECISION_PENDING: "Decision pending",
  WRITTEN_OFF: "Written off",
  CLOSED_LOST: "Closed · lost",
  PRE_ARB_FILED: "Pre-arb filed",
  CLOSED_WON: "Closed · won",
  EXPIRED: "Expired",
};

export const REASON_LABELS: Record<string, string> = {
  FRAUD: "Fraud",
  NOT_RECEIVED: "Not received",
  NOT_AS_DESCRIBED: "Not as described",
  DUPLICATE: "Duplicate",
};

export const DECISION_LABELS: Record<string, string> = {
  ACCEPT_LOSS_WRITE_OFF: "Accept loss · write off",
  ACCEPT_LOSS_REVERSE_CREDIT: "Accept loss · reverse provisional credit",
  ESCALATE_PRE_ARB: "Escalate to pre-arbitration",
};

export const ROLE_LABELS: Record<string, string> = {
  analyst: "Analyst",
  lead: "Lead",
  auditor: "Auditor",
  system: "System",
};

const ATTEMPT_LABELS: Record<string, string> = {
  file: "file the chargeback",
  propose: "propose a decision",
  approve: "approve the decision",
  reject: "reject the decision",
  evidence: "change evidence",
  import: "import a file",
  representment: "record a merchant response",
  ruling: "record a ruling",
};

const ACTION_LABELS: Record<string, string> = {
  import_batch: "Imported the daily file",
  evidence_checked: "Checked evidence",
  evidence_unchecked: "Unchecked evidence",
  chargeback_filed: "Filed the chargeback",
  representment_received: "Merchant response received",
  decision_proposed: "Proposed a decision",
  decision_executed: "Decision executed",
  decision_approved: "Approved the decision",
  decision_rejected: "Rejected the decision",
  ruling_recorded: "Network ruling recorded",
};

export interface HistoryLike {
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export function isRefusal(action: string): boolean {
  return action === "action_refused" || action === "decision_blocked";
}

/** Plain-language title for a history row. Never shows rule numbers or codes. */
export function historyTitle(h: HistoryLike): string {
  if (isRefusal(h.action)) {
    const attempted = typeof h.after?.attempted === "string" ? ATTEMPT_LABELS[h.after.attempted] : undefined;
    return `Refused: tried to ${attempted ?? "act"}`;
  }
  return ACTION_LABELS[h.action] ?? h.action.replace(/_/g, " ");
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Short human-readable changes, e.g. "Status: Decision pending → Closed · lost". */
export function historyChanges(h: HistoryLike, currency = "USD"): string[] {
  const before = h.before ?? {};
  const after = h.after ?? {};
  const out: string[] = [];
  if (isRefusal(h.action)) {
    const reason = str(after.reason);
    if (reason) out.push(reason);
    if (str(after.status) === "EXPIRED") out.push(`Status: ${STATUS_LABELS[str(before.status) ?? ""] ?? "Open"} → Expired`);
    return out;
  }
  if (h.action === "import_batch") {
    out.push(`Imported ${after.imported ?? 0} · Rejected ${after.rejected ?? 0} · Duplicates ${after.duplicates ?? 0}`);
    return out;
  }
  const fromStatus = str(before.status);
  const toStatus = str(after.status);
  if (toStatus && fromStatus !== toStatus) {
    out.push(`Status: ${fromStatus ? STATUS_LABELS[fromStatus] ?? fromStatus : "—"} → ${STATUS_LABELS[toStatus] ?? toStatus}`);
  }
  const decision = str(after.decisionType) ?? str(before.decisionType);
  if (decision && h.action.startsWith("decision")) out.push(DECISION_LABELS[decision] ?? decision);
  if (typeof before.provisionalCreditCents === "number" && typeof after.provisionalCreditCents === "number" && before.provisionalCreditCents !== after.provisionalCreditCents) {
    out.push(`Provisional credit: ${formatMoney(before.provisionalCreditCents, currency)} → ${formatMoney(after.provisionalCreditCents, currency)}`);
  }
  const label = str(after.label);
  if (label) out.push(label);
  const message = str(after.networkMessage);
  if (message) out.push(`Network message sent: ${message}`);
  return out;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
