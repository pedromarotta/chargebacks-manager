import {
  OPEN_STATUSES,
  type DecisionType,
  type NetworkMessage,
  type ReasonCode,
  type Status,
} from "../domain";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** R3: decisions at or above the threshold need a lead's approval. Per currency; unknown currencies always need approval. */
export const APPROVAL_THRESHOLD_CENTS: Readonly<Record<string, number>> = { USD: 50000 };

export const NOTE_MIN_LENGTH = 10;

/** New due_at after each step (the next network deadline). */
export const REPRESENTMENT_WINDOW_DAYS = 45;
export const RESPONSE_WINDOW_DAYS = 30;
export const ARBITRATION_WINDOW_DAYS = 30;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function isOpen(status: string): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(status);
}

/** R1 */
export function isPastDeadline(dueAt: Date, now: Date): boolean {
  return now.getTime() > dueAt.getTime();
}

/** R3 */
export function needsApproval(amountCents: number, currency: string): boolean {
  const threshold = APPROVAL_THRESHOLD_CENTS[currency];
  if (threshold === undefined) return true;
  return amountCents >= threshold;
}

/** R4 */
export function isSelfDecision(proposedBy: string | null, actorId: string): boolean {
  return proposedBy !== null && proposedBy === actorId;
}

/** R6 */
export function isValidNote(note: string | null | undefined): boolean {
  return typeof note === "string" && note.trim().length >= NOTE_MIN_LENGTH;
}

/** R7 */
export const TRANSITIONS: Readonly<Record<Status, readonly Status[]>> = {
  NEW: ["CHARGEBACK_FILED", "EXPIRED"],
  CHARGEBACK_FILED: ["REPRESENTMENT_RECEIVED", "EXPIRED"],
  REPRESENTMENT_RECEIVED: ["DECISION_PENDING", "WRITTEN_OFF", "CLOSED_LOST", "PRE_ARB_FILED", "EXPIRED"],
  DECISION_PENDING: ["WRITTEN_OFF", "CLOSED_LOST", "PRE_ARB_FILED", "REPRESENTMENT_RECEIVED", "EXPIRED"],
  PRE_ARB_FILED: ["CLOSED_WON", "CLOSED_LOST", "EXPIRED"],
  WRITTEN_OFF: [],
  CLOSED_LOST: [],
  CLOSED_WON: [],
  EXPIRED: [],
};

export function canTransition(from: Status, to: Status): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface DecisionOutcome {
  status: Status;
  message: NetworkMessage;
  reverseCredit: boolean;
}

export function outcomeFor(decision: DecisionType): DecisionOutcome {
  switch (decision) {
    case "ACCEPT_LOSS_WRITE_OFF":
      return { status: "WRITTEN_OFF", message: "ACCEPT", reverseCredit: false };
    case "ACCEPT_LOSS_REVERSE_CREDIT":
      return { status: "CLOSED_LOST", message: "ACCEPT", reverseCredit: true };
    case "ESCALATE_PRE_ARB":
      return { status: "PRE_ARB_FILED", message: "PRE_ARB", reverseCredit: false };
  }
}

/** R2: evidence checklist per reason code (BUSINESS_RULES §6 types). */
export interface EvidenceTemplateItem {
  key: string;
  label: string;
  required: boolean;
}

export const EVIDENCE_TEMPLATES: Readonly<Record<ReasonCode, readonly EvidenceTemplateItem[]>> = {
  FRAUD: [
    { key: "fraud_affidavit", label: "Fraud affidavit signed by the cardholder", required: true },
    { key: "statement", label: "Cardholder statement", required: true },
    { key: "other", label: "Other supporting documents", required: false },
  ],
  NOT_RECEIVED: [
    { key: "statement", label: "Cardholder statement", required: true },
    { key: "receipt", label: "Receipt or order confirmation", required: true },
    { key: "chat_log", label: "Contact attempts with the merchant", required: true },
    { key: "delivery_proof", label: "Carrier tracking showing no delivery", required: false },
  ],
  NOT_AS_DESCRIBED: [
    { key: "statement", label: "Cardholder statement", required: true },
    { key: "receipt", label: "Receipt or order confirmation", required: true },
    { key: "chat_log", label: "Contact attempts with the merchant", required: true },
    { key: "other", label: "Photos or other supporting documents", required: false },
  ],
  DUPLICATE: [
    { key: "statement", label: "Statement showing both charges", required: true },
    { key: "receipt", label: "Receipt for the single purchase", required: false },
  ],
};

export function missingRequiredEvidence<T extends { required: boolean; checked: boolean }>(items: readonly T[]): T[] {
  return items.filter((item) => item.required && !item.checked);
}

/** BUSINESS_RULES §3 */
export type RiskTier = "breached" | "imminent" | "near" | "ok";

export function riskTier(dueAt: Date, now: Date): RiskTier {
  const left = dueAt.getTime() - now.getTime();
  if (left <= 0) return "breached";
  if (left <= 24 * HOUR_MS) return "imminent";
  if (left <= 72 * HOUR_MS) return "near";
  return "ok";
}

export const RISK_ORDER: Readonly<Record<RiskTier, number>> = { breached: 0, imminent: 1, near: 2, ok: 3 };

export function isAtRiskOfTimeout(status: string, dueAt: Date, now: Date): boolean {
  return isOpen(status) && riskTier(dueAt, now) !== "ok";
}

/** Open cases first by risk tier then due_at; closed cases last, most recent first. */
export function compareByDeadlineRisk(
  a: { status: string; dueAt: Date; updatedAt: Date },
  b: { status: string; dueAt: Date; updatedAt: Date },
  now: Date,
): number {
  const aOpen = isOpen(a.status);
  const bOpen = isOpen(b.status);
  if (aOpen !== bOpen) return aOpen ? -1 : 1;
  if (!aOpen) return b.updatedAt.getTime() - a.updatedAt.getTime();
  const tier = RISK_ORDER[riskTier(a.dueAt, now)] - RISK_ORDER[riskTier(b.dueAt, now)];
  return tier !== 0 ? tier : a.dueAt.getTime() - b.dueAt.getTime();
}
