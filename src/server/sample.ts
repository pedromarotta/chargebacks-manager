import { addDays } from "./disputes/rules";

const HEADER = "case_id,client,card_last4,merchant,amount,currency,reason_code,opened_at,due_at,merchant_response";

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * Today's disputes file: 14 rows from three clients. 10 new disputes, 2 merchant
 * responses, 1 with a full (test) card number in the merchant field, 1 with no amount.
 */
export function buildSampleCsv(now = new Date()): string {
  const iso = (days: number) => addDays(now, days).toISOString().replace(/\.\d{3}Z$/, "Z");
  const rows: string[][] = [
    ["CB-2001", "Norte Bank", "4821", "Amazon", "89.99", "USD", "NOT_RECEIVED", iso(-2), iso(0.5), ""],
    ["CB-2002", "Pampa Wallet", "1934", "Netflix", "15.49", "USD", "DUPLICATE", iso(-1), iso(2), ""],
    ["CB-2003", "Andes Pay", "7702", "Uber", "42.10", "USD", "FRAUD", iso(-1), iso(2.5), ""],
    ["CB-2004", "Norte Bank", "3390", "Airbnb", "1180.00", "USD", "NOT_AS_DESCRIBED", iso(-3), iso(5), ""],
    ["CB-2005", "Pampa Wallet", "6612", "MercadoLibre", "254.75", "USD", "NOT_RECEIVED", iso(-2), iso(6), ""],
    ["CB-2006", "Andes Pay", "0458", "Rappi", "27.30", "USD", "NOT_AS_DESCRIBED", iso(-1), iso(7), ""],
    ["CB-2007", "Norte Bank", "8823", "Apple", "999.00", "USD", "FRAUD", iso(-1), iso(8), ""],
    ["CB-2008", "Pampa Wallet", "2205", "Spotify", "10.99", "USD", "DUPLICATE", iso(-1), iso(9), ""],
    ["CB-2009", "Andes Pay", "5147", "Amazon", "640.00", "USD", "FRAUD", iso(-2), iso(10), ""],
    ["CB-2010", "Norte Bank", "9071", "Uber", "18.60", "USD", "NOT_AS_DESCRIBED", iso(-1), iso(12), ""],
    [
      "CB-2011",
      "Pampa Wallet",
      "3348",
      "Netflix",
      "45.98",
      "USD",
      "DUPLICATE",
      iso(-40),
      iso(1.5),
      "The two charges are for two separate profiles, each billed monthly.",
    ],
    [
      "CB-2012",
      "Andes Pay",
      "6190",
      "Apple",
      "1499.00",
      "USD",
      "FRAUD",
      iso(-38),
      iso(4),
      "Purchase made on the cardholder's registered device with Face ID; same device used for 2 years.",
    ],
    ["CB-2013", "Norte Bank", "1111", "Spotify 4111 1111 1111 1111", "9.99", "USD", "FRAUD", iso(-1), iso(6), ""],
    ["CB-2014", "Andes Pay", "2468", "Rappi", "", "USD", "NOT_RECEIVED", iso(-1), iso(6), ""],
  ];
  return [HEADER, ...rows.map((r) => r.map(csvCell).join(","))].join("\n") + "\n";
}
