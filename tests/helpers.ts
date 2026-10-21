import { prisma } from "@/server/db";
import type { Actor, ReasonCode, Status } from "@/server/domain";
import { EVIDENCE_TEMPLATES, addDays } from "@/server/disputes/rules";
import { SEED_USERS, seed } from "@/server/seed";

export const users = Object.fromEntries(SEED_USERS.map((u) => [u.id.slice(2), u])) as Record<
  "ana" | "ben" | "carla" | "eve" | "dan",
  Actor
>;

export async function seedDb() {
  await seed(prisma);
}

let counter = 0;

/** Creates a fresh case directly (test fixture). */
export async function makeCase(over: {
  status?: Status;
  amountCents?: number;
  currency?: string;
  reasonCode?: ReasonCode;
  dueInDays?: number;
  evidenceChecked?: boolean;
  proposedBy?: string | null;
  decisionType?: string | null;
  provisionalCreditCents?: number;
} = {}) {
  counter += 1;
  const id = `T-${Date.now().toString(36)}-${counter}`;
  const reasonCode = over.reasonCode ?? "FRAUD";
  const amountCents = over.amountCents ?? 10000;
  return prisma.dispute.create({
    data: {
      id,
      client: "Norte Bank",
      cardLast4: "1234",
      merchant: "Amazon",
      amountCents,
      currency: over.currency ?? "USD",
      reasonCode,
      openedAt: addDays(new Date(), -5),
      dueAt: addDays(new Date(), over.dueInDays ?? 5),
      status: over.status ?? "REPRESENTMENT_RECEIVED",
      provisionalCreditCents: over.provisionalCreditCents ?? amountCents,
      merchantResponse: "Merchant says the purchase was legitimate.",
      decisionType: over.decisionType ?? null,
      proposedBy: over.proposedBy ?? null,
      evidence: {
        create: EVIDENCE_TEMPLATES[reasonCode].map((e) => ({ ...e, checked: over.evidenceChecked ?? false })),
      },
    },
  });
}

export async function historyFor(disputeId: string) {
  return prisma.history.findMany({ where: { disputeId }, orderBy: { id: "asc" } });
}

export async function networkCallsFor(disputeId: string) {
  return prisma.networkCall.findMany({ where: { disputeId } });
}
