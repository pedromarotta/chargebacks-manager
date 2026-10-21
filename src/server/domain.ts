export const ROLES = ["analyst", "lead", "auditor"] as const;
export type Role = (typeof ROLES)[number];

export type ActorRole = Role | "system";

export interface Actor {
  id: string;
  name: string;
  role: ActorRole;
}

export const STATUSES = [
  "NEW",
  "CHARGEBACK_FILED",
  "FILING_REJECTED",
  "REPRESENTMENT_RECEIVED",
  "DECISION_PENDING",
  "WRITTEN_OFF",
  "CLOSED_LOST",
  "PRE_ARB_FILED",
  "CLOSED_WON",
  "EXPIRED",
] as const;
export type Status = (typeof STATUSES)[number];

export const OPEN_STATUSES: readonly Status[] = [
  "NEW",
  "CHARGEBACK_FILED",
  "FILING_REJECTED",
  "REPRESENTMENT_RECEIVED",
  "DECISION_PENDING",
  "PRE_ARB_FILED",
];

export const CLOSED_STATUSES: readonly Status[] = ["WRITTEN_OFF", "CLOSED_LOST", "CLOSED_WON", "EXPIRED"];

export const REASON_CODES = ["FRAUD", "NOT_RECEIVED", "NOT_AS_DESCRIBED", "DUPLICATE"] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const DECISION_TYPES = ["ACCEPT_LOSS_WRITE_OFF", "ACCEPT_LOSS_REVERSE_CREDIT", "ESCALATE_PRE_ARB"] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];

export const NETWORK_MESSAGES = ["CHARGEBACK", "ACCEPT", "PRE_ARB"] as const;
export type NetworkMessage = (typeof NETWORK_MESSAGES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function isStatus(value: string): value is Status {
  return (STATUSES as readonly string[]).includes(value);
}

export function isDecisionType(value: string | null): value is DecisionType {
  return value !== null && (DECISION_TYPES as readonly string[]).includes(value);
}

export function isReasonCode(value: string): value is ReasonCode {
  return (REASON_CODES as readonly string[]).includes(value);
}
