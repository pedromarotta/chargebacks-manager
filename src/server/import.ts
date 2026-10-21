import { isReasonCode, type ReasonCode } from "./domain";
import { APPROVAL_THRESHOLD_CENTS } from "./disputes/rules";

export const EXPECTED_COLUMNS = [
  "case_id",
  "client",
  "card_last4",
  "merchant",
  "amount",
  "currency",
  "reason_code",
  "opened_at",
  "due_at",
  "merchant_response",
] as const;
type Column = (typeof EXPECTED_COLUMNS)[number];

export interface ValidDisputeRow {
  caseId: string;
  client: string;
  cardLast4: string;
  merchant: string;
  amountCents: number;
  currency: string;
  reasonCode: ReasonCode;
  openedAt: Date | null;
  dueAt: Date;
  merchantResponse: string | null;
}

export type ParsedRow =
  | { rowNumber: number; valid: true; row: ValidDisputeRow }
  | { rowNumber: number; valid: false; caseId: string | null; reasons: string[] };

export type ParsedFile = { ok: true; rows: ParsedRow[] } | { ok: false; error: string };

/** Minimal RFC 4180 parser: quoted fields, escaped quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** True if the value holds any 13–19 digit number (spaces or dashes allowed) that passes Luhn. */
export function containsCardNumber(value: string): boolean {
  const candidates = value.match(/\d(?:[ -]?\d){12,}/g) ?? [];
  for (const candidate of candidates) {
    const digits = candidate.replace(/[ -]/g, "");
    if (digits.length <= 19) {
      if (passesLuhn(digits)) return true;
      continue;
    }
    // A longer digit run could hide a PAN glued to other digits; check every window.
    for (let len = 13; len <= 19; len++) {
      for (let start = 0; start + len <= digits.length; start++) {
        if (passesLuhn(digits.slice(start, start + len))) return true;
      }
    }
  }
  return false;
}

/** Replaces every card-number-looking digit run with a marker. Last line of defense for anything written or exported. */
export function redactCardNumbers(value: string): string {
  return value.replace(/\d(?:[ -]?\d){12,}/g, (m) => (containsCardNumber(m) ? "[card number removed]" : m));
}

const AMOUNT_RE = /^\d{1,9}(\.\d{1,2})?$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const CASE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export function parseAmountToCents(raw: string): number | null {
  if (!AMOUNT_RE.test(raw)) return null;
  const [whole, frac = ""] = raw.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return cents > 0 ? cents : null;
}

/** ISO 8601 with an offset, or a bare date (UTC). Date-only due dates mean end of that UTC day. */
export function parseUtcDate(raw: string, dateOnlyTime: "start" | "end"): Date | null {
  let iso = raw;
  if (DATE_ONLY_RE.test(raw)) iso = `${raw}T${dateOnlyTime === "end" ? "23:59:59" : "00:00:00"}Z`;
  else if (!DATETIME_RE.test(raw)) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function validateRow(cells: Record<Column, string>, rowNumber: number): ParsedRow {
  const reasons: string[] = [];
  const hasCardNumber = EXPECTED_COLUMNS.some((c) => containsCardNumber(cells[c]));
  if (hasCardNumber) reasons.push("contains a full card number");

  const caseId = cells.case_id;
  const safeCaseId = CASE_ID_RE.test(caseId) && !containsCardNumber(caseId) ? caseId : null;
  if (!caseId) reasons.push("missing case_id");
  else if (!safeCaseId) reasons.push("invalid case_id");

  if (!cells.client) reasons.push("missing client");
  else if (cells.client.length > 120) reasons.push("client is too long");

  if (!cells.merchant) reasons.push("missing merchant");
  else if (cells.merchant.length > 120) reasons.push("merchant is too long");

  if (!/^\d{4}$/.test(cells.card_last4)) reasons.push("card field must be exactly 4 digits");

  const amountCents = cells.amount ? parseAmountToCents(cells.amount) : null;
  if (!cells.amount) reasons.push("missing amount");
  else if (amountCents === null) reasons.push("invalid amount");

  const currency = cells.currency.toUpperCase();
  if (!cells.currency) reasons.push("missing currency");
  else if (!/^[A-Z]{3}$/.test(currency)) reasons.push("invalid currency");
  else if (!(currency in APPROVAL_THRESHOLD_CENTS)) reasons.push(`unsupported currency ${currency}`);

  const reasonCode = cells.reason_code.toUpperCase();
  if (!cells.reason_code) reasons.push("missing reason_code");
  else if (!isReasonCode(reasonCode)) reasons.push("invalid reason_code");

  const dueAt = cells.due_at ? parseUtcDate(cells.due_at, "end") : null;
  if (!cells.due_at) reasons.push("missing due_at");
  else if (!dueAt) reasons.push("invalid due_at");

  const openedAt = cells.opened_at ? parseUtcDate(cells.opened_at, "start") : null;
  if (cells.opened_at && !openedAt) reasons.push("invalid opened_at");

  if (cells.merchant_response.length > 5000) reasons.push("merchant_response is too long");

  if (reasons.length > 0 || !safeCaseId || amountCents === null || !dueAt || !isReasonCode(reasonCode)) {
    return { rowNumber, valid: false, caseId: safeCaseId, reasons };
  }

  return {
    rowNumber,
    valid: true,
    row: {
      caseId: safeCaseId,
      client: cells.client,
      cardLast4: cells.card_last4,
      merchant: cells.merchant,
      amountCents,
      currency,
      reasonCode,
      openedAt,
      dueAt,
      merchantResponse: cells.merchant_response || null,
    },
  };
}

/** Parses and validates the daily dispute file (R10). Never returns raw cells of rejected rows. */
export function parseDisputeFile(text: string): ParsedFile {
  const table = parseCsv(text);
  if (table.length === 0) return { ok: false, error: "The file is empty." };

  const header = table[0].map((h) => h.trim().toLowerCase());
  const missing = EXPECTED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return { ok: false, error: `The file is missing these columns: ${missing.join(", ")}.` };
  }
  if (table.length === 1) return { ok: false, error: "The file has no dispute rows." };

  const rows = table.slice(1).map((cells, index) => {
    const record = Object.fromEntries(
      EXPECTED_COLUMNS.map((column) => [column, (cells[header.indexOf(column)] ?? "").trim()]),
    ) as Record<Column, string>;
    return validateRow(record, index + 2);
  });
  return { ok: true, rows };
}
