/** Backlog 9: funds tracking after a won dispute (BUSINESS_RULES §5). Illustrative limits, to be checked with legal. */
export const FUNDS_STATUSES = [
  "FUNDS_NOT_YET_RECEIVED",
  "FUNDS_RECEIVED_FROM_ACQUIRER",
  "FUNDS_CREDITED_TO_PROGRAM",
  "FUNDS_CREDITED_TO_CARDHOLDER",
  "FUNDS_REVERSED",
] as const;
export type FundsStatus = (typeof FUNDS_STATUSES)[number];

export const FUNDS_STATUS_LABELS: Record<FundsStatus, string> = {
  FUNDS_NOT_YET_RECEIVED: "Not yet received",
  FUNDS_RECEIVED_FROM_ACQUIRER: "Received from acquirer",
  FUNDS_CREDITED_TO_PROGRAM: "Credited to program",
  FUNDS_CREDITED_TO_CARDHOLDER: "Credited to cardholder",
  FUNDS_REVERSED: "Reversed",
};

export const FUNDS_MOVES = ["CREDIT_CARDHOLDER", "REVERSE"] as const;
export type FundsMove = (typeof FUNDS_MOVES)[number];
export const FUNDS_MOVE_LABELS: Record<FundsMove, string> = { CREDIT_CARDHOLDER: "Credit the cardholder", REVERSE: "Reverse the funds" };
export const FUNDS_MOVE_FROM: Record<FundsMove, readonly FundsStatus[]> = {
  CREDIT_CARDHOLDER: ["FUNDS_CREDITED_TO_PROGRAM"],
  REVERSE: ["FUNDS_RECEIVED_FROM_ACQUIRER", "FUNDS_CREDITED_TO_PROGRAM"],
};

export const JURISDICTION_LIMITS: Readonly<Record<string, { maxHours: number; bufferHours: number }>> = {
  US: { maxHours: 240, bufferHours: 24 },
  EU: { maxHours: 240, bufferHours: 24 },
  BR: { maxHours: 168, bufferHours: 24 },
  MX: { maxHours: 480, bufferHours: 48 },
  CO: { maxHours: 360, bufferHours: 36 },
  PE: { maxHours: 360, bufferHours: 36 },
  CL: { maxHours: 360, bufferHours: 36 },
  AR: { maxHours: 240, bufferHours: 24 },
};

export const PARKED_BUCKETS = [
  { key: "under_24h", label: "Under 24 hours" },
  { key: "1_3d", label: "1 to 3 days" },
  { key: "3_7d", label: "3 to 7 days" },
  { key: "over_7d", label: "Over 7 days" },
  { key: "over_limit", label: "Over the limit" },
] as const;
export type ParkedBucket = (typeof PARKED_BUCKETS)[number]["key"];
export type FundsAlert = "none" | "ok" | "alert" | "over_limit";

export interface FundsInfo {
  parked: boolean;
  parkedHours: number | null;
  bucket: ParkedBucket | null;
  limitHours: number;
  alertAtHours: number;
  alert: FundsAlert;
}

const HOUR_MS = 3_600_000;

export function fundsInfo(
  v: { fundsStatus: string | null; fundsReceivedAt: string | null; fundsSettledAt: string | null; jurisdiction: string },
  now: Date,
): FundsInfo {
  const limit = JURISDICTION_LIMITS[v.jurisdiction] ?? JURISDICTION_LIMITS.US;
  const base = { limitHours: limit.maxHours, alertAtHours: limit.maxHours - limit.bufferHours };
  // Parked: received or credited to the program, but not yet credited to the cardholder.
  const parked = v.fundsStatus === "FUNDS_RECEIVED_FROM_ACQUIRER" || v.fundsStatus === "FUNDS_CREDITED_TO_PROGRAM";
  if (!v.fundsReceivedAt) return { ...base, parked: false, parkedHours: null, bucket: null, alert: "none" };
  const end = parked ? now.getTime() : v.fundsSettledAt ? new Date(v.fundsSettledAt).getTime() : now.getTime();
  const hours = Math.max(0, (end - new Date(v.fundsReceivedAt).getTime()) / HOUR_MS);
  if (!parked) return { ...base, parked: false, parkedHours: hours, bucket: null, alert: "none" };
  const bucket: ParkedBucket =
    hours >= limit.maxHours ? "over_limit" : hours < 24 ? "under_24h" : hours < 72 ? "1_3d" : hours < 168 ? "3_7d" : "over_7d";
  const alert: FundsAlert = hours >= limit.maxHours ? "over_limit" : hours >= base.alertAtHours ? "alert" : "ok";
  return { ...base, parked: true, parkedHours: hours, bucket, alert };
}
