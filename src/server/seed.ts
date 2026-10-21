import type { PrismaClient } from "@prisma/client";
import type { Actor, DecisionType, ReasonCode, Role, Status } from "./domain";
import { record, type HistoryAction } from "./history";
import { idempotencyKeyFor } from "./network";
import { EVIDENCE_TEMPLATES, addDays } from "./disputes/rules";

export const SEED_USERS: ReadonlyArray<{ id: string; name: string; role: Role }> = [
  { id: "u_ana", name: "Ana Ruiz", role: "analyst" },
  { id: "u_ben", name: "Ben Okafor", role: "analyst" },
  { id: "u_carla", name: "Carla Diaz", role: "lead" },
  { id: "u_eve", name: "Eve Park", role: "lead" },
  { id: "u_dan", name: "Dan Lee", role: "auditor" },
];

const actor = (id: string): Actor => {
  const u = SEED_USERS.find((x) => x.id === id);
  if (!u) throw new Error(`unknown seed user ${id}`);
  return u;
};
const NETWORK: Actor = { id: "network", name: "Card network (simulated)", role: "system" };

interface SeedEvent {
  daysAgo: number;
  actor: Actor;
  action: HistoryAction;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  note?: string;
  network?: "CHARGEBACK" | "ACCEPT" | "PRE_ARB";
}

interface SeedCase {
  id: string;
  client: string;
  cardLast4: string;
  merchant: string;
  amountCents: number;
  reasonCode: ReasonCode;
  status: Status;
  openedDaysAgo: number;
  dueInDays: number;
  provisionalCreditCents?: number;
  merchantResponse?: string;
  decisionType?: DecisionType;
  proposedBy?: string;
  proposalNote?: string;
  decidedBy?: string;
  checkedEvidence: "required" | "none";
  events: SeedEvent[];
}

const filed = (daysAgo: number, by = "u_ana"): SeedEvent => ({
  daysAgo,
  actor: actor(by),
  action: "chargeback_filed",
  before: { status: "NEW" },
  after: { status: "CHARGEBACK_FILED" },
  network: "CHARGEBACK",
});
const represented = (daysAgo: number, text: string): SeedEvent => ({
  daysAgo,
  actor: NETWORK,
  action: "representment_received",
  before: { status: "CHARGEBACK_FILED" },
  after: { status: "REPRESENTMENT_RECEIVED" },
  note: text,
});

const CB_1042_RESPONSE = "Transaction authenticated with 3DS 2.0; device and IP match the cardholder's history.";
const CB_1088_RESPONSE = "Item shipped as listed; photos of the packed item and the listing description attached.";

export const SEED_CASES: readonly SeedCase[] = [
  {
    id: "CB-1042",
    client: "Norte Bank",
    cardLast4: "4417",
    merchant: "Amazon",
    amountCents: 124000,
    reasonCode: "FRAUD",
    status: "REPRESENTMENT_RECEIVED",
    openedDaysAgo: 40,
    dueInDays: 6,
    merchantResponse: CB_1042_RESPONSE,
    checkedEvidence: "required",
    events: [filed(38), represented(2, CB_1042_RESPONSE)],
  },
  {
    id: "CB-1088",
    client: "Pampa Wallet",
    cardLast4: "9032",
    merchant: "MercadoLibre",
    amountCents: 231000,
    reasonCode: "NOT_AS_DESCRIBED",
    status: "DECISION_PENDING",
    openedDaysAgo: 35,
    dueInDays: 4,
    merchantResponse: CB_1088_RESPONSE,
    decisionType: "ESCALATE_PRE_ARB",
    proposedBy: "u_carla",
    proposalNote: "Photos show a different model from the listing; strong case for pre-arbitration.",
    checkedEvidence: "required",
    events: [
      filed(33, "u_ben"),
      represented(3, CB_1088_RESPONSE),
      {
        daysAgo: 1,
        actor: actor("u_carla"),
        action: "decision_proposed",
        before: { status: "REPRESENTMENT_RECEIVED" },
        after: { status: "DECISION_PENDING", decisionType: "ESCALATE_PRE_ARB", proposedBy: "u_carla" },
        note: "Photos show a different model from the listing; strong case for pre-arbitration.",
      },
    ],
  },
  {
    id: "CB-1003",
    client: "Andes Pay",
    cardLast4: "2231",
    merchant: "Airbnb",
    amountCents: 49999,
    reasonCode: "NOT_AS_DESCRIBED",
    status: "REPRESENTMENT_RECEIVED",
    openedDaysAgo: 30,
    dueInDays: 2,
    merchantResponse: "Listing photos match the property; guest checked in and stayed all nights.",
    checkedEvidence: "required",
    events: [filed(29), represented(1, "Listing photos match the property; guest checked in and stayed all nights.")],
  },
  {
    id: "CB-1004",
    client: "Andes Pay",
    cardLast4: "7765",
    merchant: "Apple",
    amountCents: 50000,
    reasonCode: "NOT_RECEIVED",
    status: "REPRESENTMENT_RECEIVED",
    openedDaysAgo: 28,
    dueInDays: 0.8,
    merchantResponse: "Carrier confirms delivery to the billing address with signature.",
    checkedEvidence: "required",
    events: [filed(27, "u_ben"), represented(1, "Carrier confirms delivery to the billing address with signature.")],
  },
  {
    id: "CB-1005",
    client: "Norte Bank",
    cardLast4: "1180",
    merchant: "Spotify",
    amountCents: 1199,
    reasonCode: "DUPLICATE",
    status: "NEW",
    openedDaysAgo: 1,
    dueInDays: 9,
    checkedEvidence: "required",
    events: [
      {
        daysAgo: 1,
        actor: actor("u_ana"),
        action: "evidence_checked",
        before: { key: "statement", checked: false },
        after: { key: "statement", label: "Statement showing both charges", checked: true },
      },
    ],
  },
  {
    id: "CB-1006",
    client: "Pampa Wallet",
    cardLast4: "5520",
    merchant: "Uber",
    amountCents: 3450,
    reasonCode: "NOT_AS_DESCRIBED",
    status: "EXPIRED",
    openedDaysAgo: 20,
    dueInDays: -2,
    checkedEvidence: "none",
    events: [
      {
        daysAgo: 1,
        actor: actor("u_ben"),
        action: "action_refused",
        before: { status: "NEW" },
        after: {
          attempted: "file",
          code: "PAST_DEADLINE",
          reason: "The network deadline for this case has passed, so it has expired.",
          status: "EXPIRED",
        },
      },
    ],
  },
  {
    id: "CB-1007",
    client: "Andes Pay",
    cardLast4: "3308",
    merchant: "Rappi",
    amountCents: 4250,
    reasonCode: "NOT_RECEIVED",
    status: "WRITTEN_OFF",
    openedDaysAgo: 50,
    dueInDays: 10,
    merchantResponse: "Courier GPS log shows the order was delivered to the door.",
    decisionType: "ACCEPT_LOSS_WRITE_OFF",
    proposedBy: "u_ana",
    proposalNote: "Courier evidence is credible and the amount is below handling cost.",
    decidedBy: "u_ana",
    checkedEvidence: "required",
    events: [
      filed(48),
      represented(6, "Courier GPS log shows the order was delivered to the door."),
      {
        daysAgo: 5,
        actor: actor("u_ana"),
        action: "decision_executed",
        before: { status: "REPRESENTMENT_RECEIVED" },
        after: { status: "WRITTEN_OFF", decisionType: "ACCEPT_LOSS_WRITE_OFF", networkMessage: "ACCEPT" },
        note: "Courier evidence is credible and the amount is below handling cost.",
        network: "ACCEPT",
      },
    ],
  },
];

/** Idempotent: fixed ids, existing users are updated, existing cases are left untouched. */
export async function seed(prisma: PrismaClient, now = new Date()): Promise<{ created: string[] }> {
  for (const u of SEED_USERS) {
    await prisma.user.upsert({ where: { id: u.id }, update: { name: u.name, role: u.role }, create: u });
  }

  const created: string[] = [];
  for (const c of SEED_CASES) {
    if (await prisma.dispute.findUnique({ where: { id: c.id } })) continue;
    await prisma.$transaction(async (tx) => {
      const decidedEvent = c.events.find((e) => e.action === "decision_executed");
      const filedEvent = c.events.find((e) => e.action === "chargeback_filed");
      const representedEvent = c.events.find((e) => e.action === "representment_received");
      await tx.dispute.create({
        data: {
          id: c.id,
          client: c.client,
          cardLast4: c.cardLast4,
          merchant: c.merchant,
          amountCents: c.amountCents,
          currency: "USD",
          reasonCode: c.reasonCode,
          openedAt: addDays(now, -c.openedDaysAgo),
          dueAt: addDays(now, c.dueInDays),
          status: c.status,
          provisionalCreditCents: c.provisionalCreditCents ?? c.amountCents,
          merchantResponse: c.merchantResponse ?? null,
          representmentReceivedAt: representedEvent ? addDays(now, -representedEvent.daysAgo) : null,
          decisionType: c.decisionType ?? null,
          proposedBy: c.proposedBy ?? null,
          proposalNote: c.proposalNote ?? null,
          decidedBy: c.decidedBy ?? null,
          decidedAt: decidedEvent ? addDays(now, -decidedEvent.daysAgo) : null,
          networkRef: filedEvent ? `NA-CHARGEBACK-SEED${c.id.slice(3)}` : null,
          evidence: {
            create: EVIDENCE_TEMPLATES[c.reasonCode].map((e) => {
              const checked = c.checkedEvidence === "required" && e.required;
              return {
                ...e,
                checked,
                checkedBy: checked ? "u_ana" : null,
                checkedAt: checked ? addDays(now, -c.openedDaysAgo + 0.5) : null,
              };
            }),
          },
        },
      });
      for (const e of c.events) {
        if (e.network) {
          await tx.networkCall.create({
            data: {
              idempotencyKey: idempotencyKeyFor(c.id, e.network),
              disputeId: c.id,
              message: e.network,
              networkRef: `NA-${e.network}-SEED${c.id.slice(3)}`,
              createdAt: addDays(now, -e.daysAgo),
            },
          });
        }
        await record(tx, {
          actor: e.actor,
          action: e.action,
          disputeId: c.id,
          before: e.before ?? null,
          after: e.after ?? null,
          note: e.note ?? null,
          at: addDays(now, -e.daysAgo),
        });
      }
    });
    created.push(c.id);
  }
  return { created };
}
