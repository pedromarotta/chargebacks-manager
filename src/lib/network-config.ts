/**
 * The simulated card network. The tool talks to a single network, modelled on
 * "Network A" from BUSINESS_RULES §4 (illustrative fees, to be confirmed).
 */
export const NETWORK = {
  name: "Network A (simulated)",
  preArbitrationFeeCents: 1500,
  arbitrationFeeCents: 65000,
  feeCurrency: "USD",
} as const;
