import { prisma } from "../db";
import type { Actor } from "../domain";
import { ok, refusal, type Result } from "../errors";
import { can } from "../policy";
import { compareByDeadlineRisk, isOpen, riskTier, type RiskTier } from "./rules";
import { toDisputeView, type DisputeView } from "./view";

/** Backlog 7: an in-app list of open cases due within 2 days. No email. Read-only. */
export const DIGEST_WINDOW_HOURS = 48;
const HOUR_MS = 3_600_000;

export const DIGEST_GROUPS = [
  { key: "past_due", label: "Past due", hint: "The deadline has passed. The next action on these will expire them." },
  { key: "today", label: "Due in the next 24 hours", hint: null },
  { key: "tomorrow", label: "Due in 24–48 hours", hint: null },
] as const;
export type DigestGroupKey = (typeof DIGEST_GROUPS)[number]["key"];

export interface DigestItem extends DisputeView {
  risk: RiskTier;
  group: DigestGroupKey;
  nextStep: string;
  needsYou: boolean;
}

export interface Digest {
  windowHours: number;
  total: number;
  needsYou: number;
  amountCents: number;
  groups: { key: DigestGroupKey; label: string; hint: string | null; items: DigestItem[] }[];
}

function groupOf(dueAt: Date, now: Date): DigestGroupKey {
  const left = dueAt.getTime() - now.getTime();
  if (left <= 0) return "past_due";
  return left <= 24 * HOUR_MS ? "today" : "tomorrow";
}

function nextStep(d: DisputeView, actor: Actor): { text: string; needsYou: boolean } {
  switch (d.status) {
    case "NEW":
      return { text: "Check the evidence and file the chargeback", needsYou: can(actor, "dispute:file") };
    case "CHARGEBACK_FILED":
      return { text: "Waiting on the merchant's response", needsYou: false };
    case "REPRESENTMENT_RECEIVED":
      return { text: "Propose a decision", needsYou: can(actor, "decision:propose") };
    case "DECISION_PENDING":
      return d.proposedBy === actor.id
        ? { text: "Waiting for a different lead to approve your proposal", needsYou: false }
        : { text: "Approve or reject the proposed decision", needsYou: can(actor, "decision:approve") };
    case "PRE_ARB_FILED":
      return { text: "Waiting on the network's ruling", needsYou: false };
    default:
      return { text: "", needsYou: false };
  }
}

export function isDueSoon(status: string, dueAt: Date, now: Date): boolean {
  return isOpen(status) && dueAt.getTime() - now.getTime() <= DIGEST_WINDOW_HOURS * HOUR_MS;
}

export async function getDueSoonDigest(actor: Actor | null, now = new Date()): Promise<Result<Digest>> {
  if (!actor) return refusal("UNAUTHENTICATED");
  if (!can(actor, "dispute:read")) return refusal("ROLE_NOT_ALLOWED");
  const cutoff = new Date(now.getTime() + DIGEST_WINDOW_HOURS * HOUR_MS);
  const rows = (await prisma.dispute.findMany({ where: { dueAt: { lte: cutoff } } }))
    .filter((d) => isDueSoon(d.status, d.dueAt, now))
    .sort((a, b) => compareByDeadlineRisk(a, b, now));
  const items: DigestItem[] = rows.map((d) => {
    const view = toDisputeView(d);
    const step = nextStep(view, actor);
    return { ...view, risk: riskTier(d.dueAt, now), group: groupOf(d.dueAt, now), nextStep: step.text, needsYou: step.needsYou };
  });
  return ok({
    windowHours: DIGEST_WINDOW_HOURS,
    total: items.length,
    needsYou: items.filter((i) => i.needsYou).length,
    amountCents: items.reduce((s, i) => s + i.amountCents, 0),
    groups: DIGEST_GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.group === g.key) })),
  });
}
