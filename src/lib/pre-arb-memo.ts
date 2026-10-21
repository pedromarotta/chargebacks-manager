/** Pre-arbitration memo templates (backlog 3). One per reason code, worded for the merchant type (BUSINESS_RULES §8). */
export const MERCHANT_TYPES = ["PHYSICAL_GOODS", "DIGITAL_SERVICE", "SERVICE_PROVIDER", "FINANCIAL_SERVICE"] as const;
export type MerchantType = (typeof MERCHANT_TYPES)[number];

export const MERCHANT_TYPE_LABELS: Record<MerchantType, string> = {
  PHYSICAL_GOODS: "Physical goods",
  DIGITAL_SERVICE: "Digital service",
  SERVICE_PROVIDER: "Service provider (travel, ride, delivery)",
  FINANCIAL_SERVICE: "Financial service",
};

export const MEMO_MIN_LENGTH = 10;
export const MEMO_MAX_LENGTH = 5000;

export interface MemoFacts {
  id: string;
  merchant: string;
  amount: string;
  cardLast4: string;
  reasonCode: string;
  merchantResponse: string | null;
}

const DELIVERY: Record<MerchantType, string> = {
  PHYSICAL_GOODS: "the merchant has not provided proof of delivery to the cardholder's address (carrier tracking with a signature or delivery confirmation)",
  DIGITAL_SERVICE: "the merchant has not shown that the cardholder accessed or downloaded the service (login, IP or usage records)",
  SERVICE_PROVIDER: "the merchant has not shown that the service was provided to the cardholder (trip, booking or completion records)",
  FINANCIAL_SERVICE: "the merchant has not shown that the funds or service were credited to an account controlled by the cardholder",
};

const DESCRIBED: Record<MerchantType, string> = {
  PHYSICAL_GOODS: "the goods received differ materially from the merchant's description, and the cardholder attempted to return them",
  DIGITAL_SERVICE: "the service did not work as described, and the cardholder contacted the merchant to resolve it",
  SERVICE_PROVIDER: "the service delivered differs materially from what was booked, and the cardholder raised it with the merchant",
  FINANCIAL_SERVICE: "the terms applied differ materially from those disclosed to the cardholder",
};

export function draftPreArbMemo(f: MemoFacts, merchantType: MerchantType): string {
  const argument: Record<string, string> = {
    FRAUD: `The cardholder states they did not authorize or take part in this transaction and has signed a fraud affidavit. The merchant's representment does not establish that the cardholder authorized the transaction${
      merchantType === "PHYSICAL_GOODS" ? " or that goods were delivered to the cardholder's verified address" : ""
    }.`,
    NOT_RECEIVED: `The cardholder states the purchase was not received. ${capitalize(DELIVERY[merchantType])}.`,
    NOT_AS_DESCRIBED: `The cardholder states ${DESCRIBED[merchantType]}.`,
    DUPLICATE: "The cardholder was charged more than once for a single purchase. Our records show the duplicate charge, and the merchant has not shown two separate purchases.",
  };
  return [
    `Pre-arbitration: case ${f.id}`,
    `Merchant: ${f.merchant} (${MERCHANT_TYPE_LABELS[merchantType]}) · Amount: ${f.amount} · Card ending ${f.cardLast4}`,
    "",
    argument[f.reasonCode] ?? "The cardholder disputes this transaction.",
    "",
    f.merchantResponse ? `The merchant responded: "${f.merchantResponse}" This does not resolve the dispute for the reasons above.` : "The merchant did not respond with compelling evidence.",
    "",
    "We request that the merchant accept liability for the full disputed amount.",
  ].join("\n");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
