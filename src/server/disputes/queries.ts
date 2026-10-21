import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { CLOSED_STATUSES, OPEN_STATUSES, type Actor } from "../domain";
import { ok, refusal, type Result } from "../errors";
import { readStoredFile } from "../files";
import { can } from "../policy";
import { compareByDeadlineRisk, isAtRiskOfTimeout, isOpen, riskTier, type RiskTier } from "./rules";
import {
  toDisputeView,
  toEvidenceFileView,
  toEvidenceView,
  toHistoryView,
  toNetworkCallView,
  type DisputeView,
  type EvidenceFileView,
  type EvidenceView,
  type HistoryView,
  type NetworkCallView,
} from "./view";

export const QUEUE_TABS = ["all", "approval", "representment", "due72", "closed"] as const;
export type QueueTab = (typeof QUEUE_TABS)[number];

export interface QueueRow extends DisputeView {
  risk: RiskTier | null;
}

export interface QueueStats {
  openCases: number;
  atRisk: number;
  amountAtRiskCents: number;
  provisionalOutstandingCents: number;
}

export interface Queue {
  rows: QueueRow[];
  clients: string[];
  stats: QueueStats;
  networkCalls: number;
  tabCounts: Record<QueueTab, number>;
}

export interface UserSummary {
  id: string;
  name: string;
  role: string;
}

export async function listUsers(): Promise<UserSummary[]> {
  const users = await prisma.user.findMany({ orderBy: { id: "asc" } });
  return users.map((u) => ({ id: u.id, name: u.name, role: u.role }));
}

function matchesTab(d: DisputeView, tab: QueueTab, actor: Actor, now: Date): boolean {
  switch (tab) {
    case "all":
      return true;
    case "approval":
      return d.status === "DECISION_PENDING" && d.proposedBy !== actor.id && can(actor, "decision:approve");
    case "representment":
      return d.status === "REPRESENTMENT_RECEIVED";
    case "due72":
      return isOpen(d.status) && new Date(d.dueAt).getTime() - now.getTime() <= 72 * 3600 * 1000;
    case "closed":
      return (CLOSED_STATUSES as readonly string[]).includes(d.status);
  }
}

export async function getQueue(
  actor: Actor | null,
  filters: { tab?: QueueTab; client?: string | null },
  now = new Date(),
): Promise<Result<Queue>> {
  if (!actor) return refusal("UNAUTHENTICATED");
  if (!can(actor, "dispute:read")) return refusal("ROLE_NOT_ALLOWED");
  const tab = filters.tab ?? "all";

  const [all, networkCalls] = await Promise.all([prisma.dispute.findMany(), prisma.networkCall.count()]);
  all.sort((a, b) => compareByDeadlineRisk(a, b, now));
  const views = all.map((d) => toDisputeView(d));

  const open = all.filter((d) => isOpen(d.status));
  const atRisk = open.filter((d) => isAtRiskOfTimeout(d.status, d.dueAt, now));
  const stats: QueueStats = {
    openCases: open.length,
    atRisk: atRisk.length,
    amountAtRiskCents: atRisk.reduce((sum, d) => sum + d.amountCents, 0),
    provisionalOutstandingCents: open.reduce((sum, d) => sum + d.provisionalCreditCents, 0),
  };

  const byClient = filters.client ? views.filter((d) => d.client === filters.client) : views;
  const tabCounts = Object.fromEntries(
    QUEUE_TABS.map((t) => [t, byClient.filter((d) => matchesTab(d, t, actor, now)).length]),
  ) as Record<QueueTab, number>;

  const rows = byClient
    .filter((d) => matchesTab(d, tab, actor, now))
    .map((d) => ({ ...d, risk: isOpen(d.status) ? riskTier(new Date(d.dueAt), now) : null }));

  const clients = [...new Set(views.map((d) => d.client))].sort();
  return ok({ rows, clients, stats, networkCalls, tabCounts });
}

export interface CaseDetail {
  dispute: DisputeView;
  risk: RiskTier | null;
  evidence: EvidenceView[];
  history: HistoryView[];
  networkCalls: NetworkCallView[];
}

export async function getCase(actor: Actor | null, id: string, now = new Date()): Promise<Result<CaseDetail>> {
  if (!actor) return refusal("UNAUTHENTICATED");
  if (!can(actor, "dispute:read")) return refusal("ROLE_NOT_ALLOWED");
  const dispute = await prisma.dispute.findUnique({
    where: { id },
    include: {
      evidence: { orderBy: { id: "asc" }, include: { files: { orderBy: { id: "asc" } } } },
      history: { orderBy: [{ at: "desc" }, { id: "desc" }] },
      networkCalls: { orderBy: { id: "asc" } },
    },
  });
  if (!dispute) return refusal("NOT_FOUND");
  return ok({
    dispute: toDisputeView(dispute),
    risk: isOpen(dispute.status) ? riskTier(dispute.dueAt, now) : null,
    evidence: dispute.evidence.map(toEvidenceView),
    history: dispute.history.map(toHistoryView),
    networkCalls: dispute.networkCalls.map(toNetworkCallView),
  });
}

export async function getEvidenceFile(
  actor: Actor | null,
  disputeId: string,
  fileId: string,
): Promise<Result<{ file: EvidenceFileView; bytes: Buffer }>> {
  if (!actor) return refusal("UNAUTHENTICATED");
  if (!can(actor, "dispute:read")) return refusal("ROLE_NOT_ALLOWED");
  const id = /^\d{1,10}$/.test(fileId) ? Number(fileId) : null;
  const file = id === null ? null : await prisma.evidenceFile.findFirst({ where: { id, disputeId } });
  const bytes = file ? await readStoredFile(file.storageKey) : null;
  if (!file || !bytes) return refusal("NOT_FOUND", "That file doesn't exist.");
  return ok({ file: toEvidenceFileView(file), bytes });
}

export const HISTORY_FILTERS = ["all", "refusals", "decisions", "imports"] as const;
export type HistoryFilter = (typeof HISTORY_FILTERS)[number];

const REFUSAL_ACTIONS = ["action_refused", "decision_blocked"];
const DECISION_ACTIONS = ["decision_proposed", "decision_executed", "decision_approved", "decision_rejected"];

export async function listHistory(
  actor: Actor | null,
  filters: { kind?: HistoryFilter; actorId?: string | null; disputeId?: string | null },
  limit: number | null = 1000,
): Promise<Result<HistoryView[]>> {
  if (!actor) return refusal("UNAUTHENTICATED");
  if (!can(actor, "history:read")) return refusal("ROLE_NOT_ALLOWED");
  const where: Prisma.HistoryWhereInput = {};
  if (filters.kind === "refusals") where.action = { in: REFUSAL_ACTIONS };
  if (filters.kind === "decisions") where.action = { in: DECISION_ACTIONS };
  if (filters.kind === "imports") where.action = "import_batch";
  if (filters.actorId) where.actorId = filters.actorId;
  if (filters.disputeId) where.disputeId = filters.disputeId;
  const rows = await prisma.history.findMany({ where, orderBy: [{ at: "desc" }, { id: "desc" }], ...(limit === null ? {} : { take: limit }) });
  return ok(rows.map(toHistoryView));
}

export function isRefusalAction(action: string): boolean {
  return REFUSAL_ACTIONS.includes(action);
}

export { OPEN_STATUSES };
