import { NETWORK } from "./network-config";

/** BUSINESS_RULES §4. Pure and shared by the server (what gets saved) and the UI (live preview). */
export const HANDLING_COST_CENTS = 3500;
export const FIGHT_THRESHOLD_CENTS = 0;

export type Recommendation = "FIGHT" | "ACCEPT";

export interface FightOrAccept {
  pWinPct: number;
  expectedRecoveryCents: number;
  preArbFeeCents: number;
  expectedArbFeeCents: number;
  handlingCostCents: number;
  expectedCostCents: number;
  expectedValueCents: number;
  recommendation: Recommendation;
}

export function isValidPWin(pWinPct: unknown): pWinPct is number {
  return typeof pWinPct === "number" && Number.isInteger(pWinPct) && pWinPct >= 0 && pWinPct <= 100;
}

/**
 * expected recovery = P(win) × amount
 * expected cost     = pre-arb fee + P(lose) × arbitration fee + handling cost
 * fight when recovery − cost > threshold, otherwise accept.
 * Returns null when the network's fees aren't in the case currency (no honest comparison possible).
 */
export function assessFightOrAccept(amountCents: number, currency: string, pWinPct: number): FightOrAccept | null {
  if (currency !== NETWORK.feeCurrency || !isValidPWin(pWinPct)) return null;
  const expectedRecoveryCents = Math.round((amountCents * pWinPct) / 100);
  const preArbFeeCents = NETWORK.preArbitrationFeeCents;
  const expectedArbFeeCents = Math.round((NETWORK.arbitrationFeeCents * (100 - pWinPct)) / 100);
  const expectedCostCents = preArbFeeCents + expectedArbFeeCents + HANDLING_COST_CENTS;
  const expectedValueCents = expectedRecoveryCents - expectedCostCents;
  return {
    pWinPct,
    expectedRecoveryCents,
    preArbFeeCents,
    expectedArbFeeCents,
    handlingCostCents: HANDLING_COST_CENTS,
    expectedCostCents,
    expectedValueCents,
    recommendation: expectedValueCents > FIGHT_THRESHOLD_CENTS ? "FIGHT" : "ACCEPT",
  };
}

/** Whether a decision type follows the recommendation (fight = escalate; accept = either accept-loss choice). */
export function followsRecommendation(decisionType: string, recommendation: string): boolean {
  return recommendation === "FIGHT" ? decisionType === "ESCALATE_PRE_ARB" : decisionType !== "ESCALATE_PRE_ARB";
}
