import type { Dispute, EvidenceItem, History, NetworkCall } from "@prisma/client";

export interface DisputeView {
  id: string;
  client: string;
  cardLast4: string;
  merchant: string;
  amountCents: number;
  currency: string;
  reasonCode: string;
  openedAt: string;
  dueAt: string;
  status: string;
  provisionalCreditCents: number;
  representmentReceivedAt: string | null;
  merchantResponse: string | null;
  decisionType: string | null;
  proposedBy: string | null;
  proposalNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  networkRef: string | null;
  updatedAt: string;
}

export interface EvidenceView {
  key: string;
  label: string;
  required: boolean;
  checked: boolean;
  checkedBy: string | null;
  checkedAt: string | null;
}

export interface HistoryView {
  id: number;
  at: string;
  actorId: string;
  actorRole: string;
  action: string;
  disputeId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  note: string | null;
}

export interface NetworkCallView {
  idempotencyKey: string;
  message: string;
  networkRef: string;
  createdAt: string;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toDisputeView(d: Dispute): DisputeView {
  return {
    id: d.id,
    client: d.client,
    cardLast4: d.cardLast4,
    merchant: d.merchant,
    amountCents: d.amountCents,
    currency: d.currency,
    reasonCode: d.reasonCode,
    openedAt: d.openedAt.toISOString(),
    dueAt: d.dueAt.toISOString(),
    status: d.status,
    provisionalCreditCents: d.provisionalCreditCents,
    representmentReceivedAt: iso(d.representmentReceivedAt),
    merchantResponse: d.merchantResponse,
    decisionType: d.decisionType,
    proposedBy: d.proposedBy,
    proposalNote: d.proposalNote,
    decidedBy: d.decidedBy,
    decidedAt: iso(d.decidedAt),
    decisionNote: d.decisionNote,
    networkRef: d.networkRef,
    updatedAt: d.updatedAt.toISOString(),
  };
}

export function toEvidenceView(e: EvidenceItem): EvidenceView {
  return {
    key: e.key,
    label: e.label,
    required: e.required,
    checked: e.checked,
    checkedBy: e.checkedBy,
    checkedAt: iso(e.checkedAt),
  };
}

function parseJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function toHistoryView(h: History): HistoryView {
  return {
    id: h.id,
    at: h.at.toISOString(),
    actorId: h.actorId,
    actorRole: h.actorRole,
    action: h.action,
    disputeId: h.disputeId,
    before: parseJson(h.before),
    after: parseJson(h.after),
    note: h.note,
  };
}

export function toNetworkCallView(c: NetworkCall): NetworkCallView {
  return {
    idempotencyKey: c.idempotencyKey,
    message: c.message,
    networkRef: c.networkRef,
    createdAt: c.createdAt.toISOString(),
  };
}
