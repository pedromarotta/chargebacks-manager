export const REFUSAL_CODES = [
  "UNAUTHENTICATED",
  "ROLE_NOT_ALLOWED",
  "NOT_FOUND",
  "INVALID_INPUT",
  "PAST_DEADLINE",
  "EVIDENCE_REQUIRED",
  "SELF_APPROVAL_BLOCKED",
  "NOTE_TOO_SHORT",
  "ALREADY_DECIDED",
  "INVALID_STATUS",
] as const;
export type RefusalCode = (typeof REFUSAL_CODES)[number];

export const HTTP_STATUS: Record<RefusalCode, number> = {
  UNAUTHENTICATED: 401,
  ROLE_NOT_ALLOWED: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  PAST_DEADLINE: 409,
  EVIDENCE_REQUIRED: 409,
  SELF_APPROVAL_BLOCKED: 409,
  NOTE_TOO_SHORT: 400,
  ALREADY_DECIDED: 409,
  INVALID_STATUS: 409,
};

/** Plain-language defaults shown in the UI. Codes never reach the UI. */
export const PLAIN_MESSAGES: Record<RefusalCode, string> = {
  UNAUTHENTICATED: "Your session is missing or invalid. Choose a user to continue.",
  ROLE_NOT_ALLOWED: "Your role can't do this.",
  NOT_FOUND: "This case doesn't exist.",
  INVALID_INPUT: "Some of the information sent was missing or invalid.",
  PAST_DEADLINE: "The network deadline for this case has passed, so it has expired.",
  EVIDENCE_REQUIRED: "Check every required evidence item before filing.",
  SELF_APPROVAL_BLOCKED: "You proposed this decision; a different lead must approve or reject it.",
  NOTE_TOO_SHORT: "Add a note of at least 10 characters explaining the reason.",
  ALREADY_DECIDED: "This decision has already been made.",
  INVALID_STATUS: "This case isn't at a step where that can be done.",
};

export interface Refusal {
  ok: false;
  code: RefusalCode;
  message: string;
  httpStatus: number;
}

export interface Success<T> {
  ok: true;
  value: T;
}

export type Result<T> = Success<T> | Refusal;

export function ok<T>(value: T): Success<T> {
  return { ok: true, value };
}

export function refusal(code: RefusalCode, message?: string): Refusal {
  return { ok: false, code, message: message ?? PLAIN_MESSAGES[code], httpStatus: HTTP_STATUS[code] };
}
