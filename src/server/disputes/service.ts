import { randomUUID } from "node:crypto";
import type { Dispute, Prisma } from "@prisma/client";
import { z } from "zod";
import { assessFightOrAccept } from "@/lib/fight-or-accept";
import { formatMoney } from "@/lib/format";
import { FUNDS_MOVE_FROM, FUNDS_MOVES, type FundsStatus } from "@/lib/funds";
import { draftPreArbMemo, MEMO_MAX_LENGTH, MEMO_MIN_LENGTH, MERCHANT_TYPES } from "@/lib/pre-arb-memo";
import { prisma, type Tx } from "../db";
import { DECISION_TYPES, isDecisionType, isStatus, type Actor, type Status } from "../domain";
import { ok, refusal, type Refusal, type RefusalCode, type Result } from "../errors";
import { record, type HistoryAction } from "../history";
import { cleanFilename, fileContainsCardNumber, MAX_FILE_BYTES, removeStoredFile, sha256Hex, sniffType, storeFile } from "../files";
import { containsCardNumber, parseDisputeFile, type ValidDisputeRow } from "../import";
import { deliverOutbox, enqueue, idempotencyKeyFor } from "../network";
import { can, type Action } from "../policy";
import {
  ARBITRATION_WINDOW_DAYS,
  EVIDENCE_TEMPLATES,
  REPRESENTMENT_WINDOW_DAYS,
  RESPONSE_WINDOW_DAYS,
  addDays,
  isOpen,
  isPastDeadline,
  isSelfDecision,
  isValidNote,
  missingRequiredEvidence,
  needsApproval,
  outcomeFor,
} from "./rules";
import { toDisputeView, toEvidenceFileView, type DisputeView, type EvidenceFileView } from "./view";

const TX_OPTIONS = { maxWait: 15_000, timeout: 15_000 };

export type Attempt = "file" | "propose" | "approve" | "reject" | "evidence" | "attach" | "memo" | "bulk_write_off" | "import" | "representment" | "ruling" | "filing_rejected" | "funds_received" | "funds_program" | "funds_propose" | "funds_approve" | "funds_reject";

const ATTEMPT_PERMISSION: Record<Attempt, Action> = {
  filing_rejected: "network:event",
  funds_received: "network:event",
  funds_program: "funds:move",
  funds_propose: "funds:move",
  funds_approve: "funds:approve",
  funds_reject: "funds:approve",
  file: "dispute:file",
  propose: "decision:propose",
  approve: "decision:approve",
  reject: "decision:reject",
  evidence: "evidence:edit",
  attach: "evidence:edit",
  memo: "decision:propose",
  bulk_write_off: "decision:propose",
  import: "dispute:import",
  representment: "network:event",
  ruling: "network:event",
};

/** Role refusals that deserve a more specific message than the generic one. */
const ROLE_MESSAGES: Partial<Record<Attempt, string>> = {
  approve: "Only a lead can approve this decision.",
  reject: "Only a lead can reject this decision.",
  funds_approve: "Only a lead can approve this funds move.",
  funds_reject: "Only a lead can reject this funds move.",
};

// ---------- Inputs (Zod on every server input) ----------

const DisputeId = z.string().min(1).max(40);
const Note = z.string().max(2000);

export const ProposeInput = z.object({
  decisionType: z.enum(DECISION_TYPES),
  note: Note.optional(),
  pWinPct: z.number().int().min(0).max(100).optional(),
  merchantType: z.enum(MERCHANT_TYPES).optional(),
  memo: z.string().max(MEMO_MAX_LENGTH).optional(),
});
export const MemoInput = z.object({ memo: z.string().max(MEMO_MAX_LENGTH) });
export const ApproveInput = z.object({ comment: Note.optional() }).optional();
export const RejectInput = z.object({ note: Note.optional() });
export const EvidenceInput = z.object({ key: z.string().min(1).max(40), checked: z.boolean() });
export const AttachFileInput = z.object({
  key: z.string().min(1).max(40),
  filename: z.string().min(1).max(255),
  bytes: z.instanceof(Uint8Array),
});
export const ImportInput = z.object({
  csv: z.string().min(1).max(2_000_000),
  filename: z.string().max(200).optional(),
  dryRun: z.boolean().optional(),
});
export const RepresentmentInput = z.object({ merchantResponse: z.string().trim().min(1).max(5000) });
export const RulingInput = z.object({ outcome: z.enum(["WON", "LOST"]) });

// ---------- Shared write plumbing ----------

interface RefuseOptions {
  message?: string;
  action?: HistoryAction;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  note?: string | null;
}

/** Writes the refusal's history row in the current transaction, then returns the refusal (R9). */
class Writer {
  bulkId: string | null = null;
  disputeId: string | null = null;

  constructor(
    readonly tx: Tx,
    readonly actor: Actor,
    readonly attempted: Attempt,
    readonly requestedId: string | null,
  ) {}

  async refuse(code: RefusalCode, opts: RefuseOptions = {}): Promise<Refusal> {
    const result = refusal(code, opts.message);
    await record(this.tx, {
      actor: this.actor,
      action: opts.action ?? "action_refused",
      disputeId: this.disputeId,
      before: opts.before ?? null,
      after: {
        attempted: this.attempted,
        code,
        reason: result.message,
        ...(this.disputeId === null && this.requestedId ? { requestedId: this.requestedId } : {}),
        ...(this.bulkId ? { bulkId: this.bulkId } : {}),
        ...opts.after,
      },
      note: opts.note ?? null,
    });
    return result;
  }
}

function unauthenticated(attempted: Attempt): Refusal {
  console.warn(`[auth] refused unauthenticated ${attempted} attempt`);
  return refusal("UNAUTHENTICATED");
}

async function inWrite<T>(
  actor: Actor | null,
  attempted: Attempt,
  requestedId: string | null,
  body: (w: Writer) => Promise<Result<T>>,
): Promise<Result<T>> {
  if (!actor) return unauthenticated(attempted);
  const result = await prisma.$transaction((tx) => body(new Writer(tx, actor, attempted, requestedId)), TX_OPTIONS);
  await deliverAfterCommit();
  return result;
}

/** Backlog 10: the network is called only after the transaction commits. Failures stay queued for `npm run outbox`. */
export async function deliverAfterCommit(): Promise<void> {
  try {
    const { failed } = await deliverOutbox();
    if (failed > 0) console.warn(`[outbox] ${failed} message(s) still pending`);
  } catch (e) {
    console.warn("[outbox] delivery failed; messages stay pending", e);
  }
}

/**
 * Loads the case and applies the checks every case write shares, in order:
 * role (R5), existence, then the deadline (R1), which expires an open case that is past due.
 */
async function loadCase(w: Writer, rawId: unknown, now: Date): Promise<Refusal | Dispute> {
  const id = DisputeId.safeParse(rawId);
  const dispute = id.success ? await w.tx.dispute.findUnique({ where: { id: id.data } }) : null;
  if (dispute) w.disputeId = dispute.id;

  if (!can(w.actor, ATTEMPT_PERMISSION[w.attempted])) {
    return w.refuse("ROLE_NOT_ALLOWED", { message: ROLE_MESSAGES[w.attempted], ...(dispute ? { before: { status: dispute.status } } : {}) });
  }
  if (!dispute) return w.refuse("NOT_FOUND");

  if (dispute.status === "EXPIRED") {
    return w.refuse("PAST_DEADLINE", { before: { status: dispute.status } });
  }
  if (isOpen(dispute.status) && isPastDeadline(dispute.dueAt, now)) {
    const expired = await w.tx.dispute.updateMany({
      where: { id: dispute.id, status: dispute.status },
      data: { status: "EXPIRED" },
    });
    return w.refuse("PAST_DEADLINE", {
      before: { status: dispute.status, dueAt: dispute.dueAt.toISOString() },
      after: expired.count === 1 ? { status: "EXPIRED" } : {},
    });
  }
  return dispute;
}

/** Backlog 6: free text from a request is refused, never stored, if it holds a full card number. */
function hasCardNumber(...texts: (string | null | undefined)[]): boolean {
  return texts.some((t) => typeof t === "string" && containsCardNumber(t));
}

function isRefusal(value: Refusal | Dispute): value is Refusal {
  return "ok" in value && value.ok === false;
}

async function reload(tx: Tx, id: string): Promise<DisputeView> {
  return toDisputeView(await tx.dispute.findUniqueOrThrow({ where: { id } }));
}

function decisionSnapshot(d: Dispute): Record<string, unknown> {
  return {
    status: d.status,
    decisionType: d.decisionType,
    proposedBy: d.proposedBy,
    proposalNote: d.proposalNote,
    provisionalCreditCents: d.provisionalCreditCents,
    pWinPct: d.pWinPct,
    expectedValueCents: d.expectedValueCents,
    recommendation: d.recommendation,
    merchantType: d.merchantType,
    preArbMemo: d.preArbMemo,
  };
}

function memoFacts(d: Dispute) {
  return {
    id: d.id,
    merchant: d.merchant,
    amount: formatMoney(d.amountCents, d.currency),
    cardLast4: d.cardLast4,
    reasonCode: d.reasonCode,
    merchantResponse: d.merchantResponse,
  };
}

function memoProblem(text: string): string | null {
  if (text.replace(/\s/g, "").length < MEMO_MIN_LENGTH) return "The memo needs at least 10 characters.";
  if (containsCardNumber(text)) return "The memo appears to contain a full card number. Use the last 4 digits only.";
  return null;
}

function statusOf(d: Dispute): Status {
  if (!isStatus(d.status)) throw new Error(`Unknown status ${d.status} on ${d.id}`);
  return d.status;
}

// ---------- Actions ----------

/** Action 1: file the chargeback (R1, R2, R5, R7, R8, R9). */
export async function fileChargeback(actor: Actor | null, disputeId: unknown, now = new Date()): Promise<Result<DisputeView>> {
  return inWrite(actor, "file", String(disputeId), async (w) => {
    const d = await loadCase(w, disputeId, now);
    if (isRefusal(d)) return d;
    if (statusOf(d) !== "NEW") {
      return w.refuse("INVALID_STATUS", {
        message: "Only new cases can be filed.",
        before: { status: d.status },
      });
    }

    const evidence = await w.tx.evidenceItem.findMany({ where: { disputeId: d.id }, orderBy: { id: "asc" } });
    const missing = missingRequiredEvidence(evidence);
    if (missing.length > 0) {
      return w.refuse("EVIDENCE_REQUIRED", {
        message: `Check every required evidence item before filing. Missing: ${missing.map((m) => m.label).join("; ")}.`,
        before: { status: d.status },
        after: { missing: missing.map((m) => m.key) },
      });
    }

    const dueAt = addDays(now, REPRESENTMENT_WINDOW_DAYS);
    const claimed = await w.tx.dispute.updateMany({
      where: { id: d.id, status: "NEW" },
      data: { status: "CHARGEBACK_FILED", dueAt },
    });
    if (claimed.count !== 1) return w.refuse("INVALID_STATUS", { message: "This case was already filed." });

    await enqueue(w.tx, {
      idempotencyKey: idempotencyKeyFor(d.id, "CHARGEBACK"),
      disputeId: d.id,
      message: "CHARGEBACK",
    });
    await record(w.tx, {
      actor: w.actor,
      action: "chargeback_filed",
      disputeId: d.id,
      before: { status: d.status, dueAt: d.dueAt.toISOString() },
      after: { status: "CHARGEBACK_FILED", dueAt: dueAt.toISOString(), networkMessage: "CHARGEBACK" },
    });
    return ok(await reload(w.tx, d.id));
  });
}

/** Action 3: propose a decision (R1, R3, R5, R6, R7, R8, R9). Under the threshold it executes at once. */
export async function proposeDecision(
  actor: Actor | null,
  disputeId: unknown,
  input: unknown,
  now = new Date(),
): Promise<Result<DisputeView>> {
  return inWrite(actor, "propose", String(disputeId), (w) => proposeIn(w, disputeId, input, now));
}

async function proposeIn(w: Writer, disputeId: unknown, input: unknown, now: Date): Promise<Result<DisputeView>> {
  const d = await loadCase(w, disputeId, now);
  if (isRefusal(d)) return d;
  const parsed = ProposeInput.safeParse(input);
  if (!parsed.success) {
    return w.refuse("INVALID_INPUT", { message: "Choose one of the three decisions; P(win) must be a whole number from 0 to 100." });
  }
  const { decisionType, note, pWinPct } = parsed.data;
  if (hasCardNumber(note)) return w.refuse("CARD_NUMBER", { before: { status: d.status } });

  const from = statusOf(d);
  if (from === "FILING_REJECTED" && decisionType === "ESCALATE_PRE_ARB") {
    return w.refuse("INVALID_STATUS", {
      message: "The network rejected this filing, so it can't go to pre-arbitration. Write it off or reverse the credit.",
      before: { status: d.status },
    });
  }
  if (from !== "REPRESENTMENT_RECEIVED" && from !== "FILING_REJECTED") {
    return w.refuse("INVALID_STATUS", {
      message:
        d.status === "DECISION_PENDING"
          ? "A decision is already waiting for approval on this case."
          : "Decisions can only be proposed once the merchant's representment has arrived.",
      before: { status: d.status },
      note,
    });
  }
  if (!isValidNote(note)) return w.refuse("NOTE_TOO_SHORT", { before: { status: d.status }, note });
  if (w.attempted === "bulk_write_off" && needsApproval(d.amountCents, d.currency)) {
    return w.refuse("BULK_LIMIT", { before: { status: d.status, amountCents: d.amountCents } });
  }
  const trimmedNote = (note ?? "").trim();
  // Computed from the amount in the database, never from the request (backlog 0).
  const assessment = pWinPct === undefined ? null : assessFightOrAccept(d.amountCents, d.currency, pWinPct);
  const helper = {
    pWinPct: assessment?.pWinPct ?? null,
    expectedValueCents: assessment?.expectedValueCents ?? null,
    recommendation: assessment?.recommendation ?? null,
  };
  // Backlog 3: escalations carry a pre-arbitration memo; without one, the template draft is used.
  let memo: { merchantType: string | null; preArbMemo: string | null } = { merchantType: null, preArbMemo: null };
  if (decisionType === "ESCALATE_PRE_ARB") {
    const merchantType = parsed.data.merchantType ?? "PHYSICAL_GOODS";
    const text = (parsed.data.memo ?? "").trim() || draftPreArbMemo(memoFacts(d), merchantType);
    const problem = memoProblem(text);
    if (problem) return w.refuse("INVALID_INPUT", { message: problem, before: { status: d.status } });
    memo = { merchantType, preArbMemo: text };
  }

  if (needsApproval(d.amountCents, d.currency)) {
    const claimed = await w.tx.dispute.updateMany({
      where: { id: d.id, status: from },
      data: { status: "DECISION_PENDING", decisionType, proposedBy: w.actor.id, proposalNote: trimmedNote, ...helper, ...memo },
    });
    if (claimed.count !== 1) return w.refuse("INVALID_STATUS", { message: "This case changed; reload and try again." });
    await record(w.tx, {
      actor: w.actor,
      action: "decision_proposed",
      disputeId: d.id,
      before: { status: d.status },
      after: { status: "DECISION_PENDING", decisionType, proposedBy: w.actor.id, ...helper, ...memo },
      note: trimmedNote,
    });
    return ok(await reload(w.tx, d.id));
  }

  const outcome = outcomeFor(decisionType);
  const claimed = await w.tx.dispute.updateMany({
    where: { id: d.id, status: from },
    data: {
      status: outcome.status,
      decisionType,
      proposedBy: w.actor.id,
      proposalNote: trimmedNote,
      ...helper,
      ...memo,
      decidedBy: w.actor.id,
      decidedAt: now,
      ...(outcome.reverseCredit ? { provisionalCreditCents: 0 } : {}),
      ...(outcome.status === "PRE_ARB_FILED" ? { dueAt: addDays(now, ARBITRATION_WINDOW_DAYS) } : {}),
    },
  });
  if (claimed.count !== 1) return w.refuse("INVALID_STATUS", { message: "This case changed; reload and try again." });
  const sent = d.filingRejectedAt ? null : await enqueue(w.tx, {
    idempotencyKey: idempotencyKeyFor(d.id, outcome.message),
    disputeId: d.id,
    message: outcome.message,
  });
  const after = await w.tx.dispute.findUniqueOrThrow({ where: { id: d.id } });
  await record(w.tx, {
    actor: w.actor,
    action: "decision_executed",
    disputeId: d.id,
    before: decisionSnapshot(d),
    after: { ...decisionSnapshot(after), networkMessage: sent ? outcome.message : null, ...(w.bulkId ? { bulkId: w.bulkId } : {}) },
    note: trimmedNote,
  });
  return ok(toDisputeView(after));
}

/** Action 4a: approve a pending decision (R1, R4, R5, R7, R8, R9). */
export async function approveDecision(
  actor: Actor | null,
  disputeId: unknown,
  input: unknown,
  now = new Date(),
): Promise<Result<DisputeView>> {
  return inWrite(actor, "approve", String(disputeId), async (w) => {
    const d = await loadCase(w, disputeId, now);
    if (isRefusal(d)) return d;
    const parsed = ApproveInput.safeParse(input);
    if (!parsed.success) return w.refuse("INVALID_INPUT");
    const comment = parsed.data?.comment?.trim() || null;
    if (hasCardNumber(comment)) return w.refuse("CARD_NUMBER", { before: { status: d.status } });

    if (statusOf(d) !== "DECISION_PENDING" || !isDecisionType(d.decisionType)) {
      return w.refuse("ALREADY_DECIDED", { before: { status: d.status } });
    }
    if (isSelfDecision(d.proposedBy, w.actor.id)) {
      return w.refuse("SELF_APPROVAL_BLOCKED", {
        action: "decision_blocked",
        before: decisionSnapshot(d),
        note: comment,
      });
    }

    const outcome = outcomeFor(d.decisionType);
    const decided = await w.tx.dispute.updateMany({
      where: { id: d.id, status: "DECISION_PENDING" },
      data: {
        status: outcome.status,
        decidedBy: w.actor.id,
        decidedAt: now,
        decisionNote: comment,
        ...(outcome.reverseCredit ? { provisionalCreditCents: 0 } : {}),
        ...(outcome.status === "PRE_ARB_FILED" ? { dueAt: addDays(now, ARBITRATION_WINDOW_DAYS) } : {}),
      },
    });
    if (decided.count !== 1) return w.refuse("ALREADY_DECIDED", { before: { status: d.status } });

    const sent = d.filingRejectedAt ? null : await enqueue(w.tx, {
      idempotencyKey: idempotencyKeyFor(d.id, outcome.message),
      disputeId: d.id,
      message: outcome.message,
    });
    const after = await w.tx.dispute.findUniqueOrThrow({ where: { id: d.id } });
    await record(w.tx, {
      actor: w.actor,
      action: "decision_approved",
      disputeId: d.id,
      before: decisionSnapshot(d),
      after: { ...decisionSnapshot(after), networkMessage: sent ? outcome.message : null },
      note: comment,
    });
    return ok(toDisputeView(after));
  });
}

/** Action 4b: reject a pending decision (R1, R4, R5, R6, R7, R9). The case returns to REPRESENTMENT_RECEIVED. */
export async function rejectDecision(
  actor: Actor | null,
  disputeId: unknown,
  input: unknown,
  now = new Date(),
): Promise<Result<DisputeView>> {
  return inWrite(actor, "reject", String(disputeId), async (w) => {
    const d = await loadCase(w, disputeId, now);
    if (isRefusal(d)) return d;
    const parsed = RejectInput.safeParse(input);
    if (!parsed.success) return w.refuse("INVALID_INPUT");
    const note = parsed.data.note;
    if (hasCardNumber(note)) return w.refuse("CARD_NUMBER", { before: { status: d.status } });

    if (statusOf(d) !== "DECISION_PENDING") {
      return w.refuse("ALREADY_DECIDED", { before: { status: d.status }, note });
    }
    if (isSelfDecision(d.proposedBy, w.actor.id)) {
      return w.refuse("SELF_APPROVAL_BLOCKED", { action: "decision_blocked", before: decisionSnapshot(d), note });
    }
    if (!isValidNote(note)) return w.refuse("NOTE_TOO_SHORT", { before: { status: d.status }, note });

    const decided = await w.tx.dispute.updateMany({
      where: { id: d.id, status: "DECISION_PENDING" },
      data: {
        status: d.filingRejectedAt ? "FILING_REJECTED" : "REPRESENTMENT_RECEIVED",
        decisionType: null,
        proposedBy: null,
        proposalNote: null,
        decidedBy: null,
        decidedAt: null,
        decisionNote: null,
        pWinPct: null,
        expectedValueCents: null,
        recommendation: null,
        merchantType: null,
        preArbMemo: null,
      },
    });
    if (decided.count !== 1) return w.refuse("ALREADY_DECIDED", { before: { status: d.status } });
    await record(w.tx, {
      actor: w.actor,
      action: "decision_rejected",
      disputeId: d.id,
      before: decisionSnapshot(d),
      after: { status: d.filingRejectedAt ? "FILING_REJECTED" : "REPRESENTMENT_RECEIVED", decisionType: null, proposedBy: null },
      note: (note ?? "").trim(),
    });
    return ok(await reload(w.tx, d.id));
  });
}

const EVIDENCE_EDITABLE: readonly Status[] = ["NEW", "CHARGEBACK_FILED", "REPRESENTMENT_RECEIVED"];

/** Check or uncheck an evidence item (R5, R9). */
export async function setEvidence(
  actor: Actor | null,
  disputeId: unknown,
  input: unknown,
  now = new Date(),
): Promise<Result<DisputeView>> {
  return inWrite(actor, "evidence", String(disputeId), async (w) => {
    const id = DisputeId.safeParse(disputeId);
    const d = id.success ? await w.tx.dispute.findUnique({ where: { id: id.data } }) : null;
    if (d) w.disputeId = d.id;
    if (!can(w.actor, "evidence:edit")) return w.refuse("ROLE_NOT_ALLOWED");
    if (!d) return w.refuse("NOT_FOUND");
    const parsed = EvidenceInput.safeParse(input);
    if (!parsed.success) return w.refuse("INVALID_INPUT");
    if (!EVIDENCE_EDITABLE.includes(statusOf(d))) {
      return w.refuse("INVALID_STATUS", {
        message: "Evidence can't be changed at this step.",
        before: { status: d.status },
      });
    }
    const item = await w.tx.evidenceItem.findUnique({
      where: { disputeId_key: { disputeId: d.id, key: parsed.data.key } },
    });
    if (!item) return w.refuse("NOT_FOUND", { message: "That evidence item doesn't exist on this case." });
    if (item.checked === parsed.data.checked) return ok(toDisputeView(d));

    await w.tx.evidenceItem.update({
      where: { id: item.id },
      data: parsed.data.checked
        ? { checked: true, checkedBy: w.actor.id, checkedAt: now }
        : { checked: false, checkedBy: null, checkedAt: null },
    });
    await w.tx.dispute.update({ where: { id: d.id }, data: { updatedAt: now } });
    await record(w.tx, {
      actor: w.actor,
      action: parsed.data.checked ? "evidence_checked" : "evidence_unchecked",
      disputeId: d.id,
      before: { key: item.key, checked: item.checked },
      after: { key: item.key, label: item.label, checked: parsed.data.checked },
    });
    return ok(await reload(w.tx, d.id));
  });
}

/**
 * Attach a file to an evidence item (backlog 2; R5, R9, R10 hygiene). The file is written last,
 * just before the row and its history entry, and removed again if the transaction fails.
 */
export async function attachEvidenceFile(
  actor: Actor | null,
  disputeId: unknown,
  input: unknown,
  now = new Date(),
): Promise<Result<EvidenceFileView>> {
  let storedKey: string | null = null;
  try {
    return await inWrite(actor, "attach", String(disputeId), async (w) => {
      const id = DisputeId.safeParse(disputeId);
      const d = id.success ? await w.tx.dispute.findUnique({ where: { id: id.data } }) : null;
      if (d) w.disputeId = d.id;
      if (!can(w.actor, "evidence:edit")) return w.refuse("ROLE_NOT_ALLOWED");
      if (!d) return w.refuse("NOT_FOUND");
      const parsed = AttachFileInput.safeParse(input);
      if (!parsed.success) return w.refuse("INVALID_INPUT", { message: "Choose a file to attach." });
      if (!EVIDENCE_EDITABLE.includes(statusOf(d))) {
        return w.refuse("INVALID_STATUS", { message: "Evidence can't be changed at this step.", before: { status: d.status } });
      }
      const item = await w.tx.evidenceItem.findUnique({
        where: { disputeId_key: { disputeId: d.id, key: parsed.data.key } },
      });
      if (!item) return w.refuse("NOT_FOUND", { message: "That evidence item doesn't exist on this case." });

      const { bytes } = parsed.data;
      if (bytes.byteLength === 0) return w.refuse("INVALID_INPUT", { message: "The file is empty." });
      if (bytes.byteLength > MAX_FILE_BYTES) return w.refuse("INVALID_INPUT", { message: "The file is larger than 5 MB." });
      const contentType = sniffType(bytes);
      if (!contentType) return w.refuse("INVALID_INPUT", { message: "Only PDF, PNG and JPEG files can be attached." });
      if (fileContainsCardNumber(parsed.data.filename, bytes)) {
        return w.refuse("INVALID_INPUT", {
          message: "This file appears to contain a full card number. Redact it to the last 4 digits and attach it again.",
        });
      }

      const filename = cleanFilename(parsed.data.filename);
      const sha256 = sha256Hex(bytes);
      storedKey = await storeFile(bytes);
      const file = await w.tx.evidenceFile.create({
        data: {
          evidenceItemId: item.id,
          disputeId: d.id,
          filename,
          contentType,
          sizeBytes: bytes.byteLength,
          sha256,
          storageKey: storedKey,
          uploadedBy: w.actor.id,
          uploadedAt: now,
        },
      });
      await w.tx.dispute.update({ where: { id: d.id }, data: { updatedAt: now } });
      await record(w.tx, {
        actor: w.actor,
        action: "evidence_file_attached",
        disputeId: d.id,
        after: { key: item.key, label: item.label, fileId: file.id, filename, contentType, sizeBytes: bytes.byteLength, sha256 },
      });
      return ok(toEvidenceFileView(file));
    });
  } catch (err) {
    if (storedKey) await removeStoredFile(storedKey);
    throw err;
  }
}

/** Backlog 3: the proposer edits the pre-arbitration memo while the escalation waits for approval. */
export async function editMemo(actor: Actor | null, disputeId: unknown, input: unknown, now = new Date()): Promise<Result<DisputeView>> {
  return inWrite(actor, "memo", String(disputeId), async (w) => {
    const d = await loadCase(w, disputeId, now);
    if (isRefusal(d)) return d;
    const parsed = MemoInput.safeParse(input);
    if (!parsed.success) return w.refuse("INVALID_INPUT", { message: "The memo can be at most 5,000 characters." });
    if (d.status !== "DECISION_PENDING" || d.decisionType !== "ESCALATE_PRE_ARB") {
      return w.refuse("INVALID_STATUS", {
        message: "The memo can only be edited while an escalation is waiting for approval.",
        before: { status: d.status },
      });
    }
    if (d.proposedBy !== w.actor.id) {
      return w.refuse("ROLE_NOT_ALLOWED", { message: "Only the person who proposed the escalation can edit its memo." });
    }
    const text = parsed.data.memo.trim();
    const problem = memoProblem(text);
    if (problem) return w.refuse("INVALID_INPUT", { message: problem });
    if (text === d.preArbMemo) return ok(toDisputeView(d));
    const updated = await w.tx.dispute.updateMany({
      where: { id: d.id, status: "DECISION_PENDING", proposedBy: w.actor.id },
      data: { preArbMemo: text, updatedAt: now },
    });
    if (updated.count !== 1) return w.refuse("ALREADY_DECIDED", { message: "This decision was just made; the memo can't change now." });
    await record(w.tx, {
      actor: w.actor,
      action: "memo_edited",
      disputeId: d.id,
      before: { preArbMemo: d.preArbMemo },
      after: { preArbMemo: text },
    });
    return ok(await reload(w.tx, d.id));
  });
}

/** Backlog 4: write off several small cases at once. Each case runs the normal propose path in its own transaction. */
export const BULK_MAX = 50;
export const BulkWriteOffInput = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(BULK_MAX),
  note: Note,
});
export interface BulkItemResult {
  id: string;
  ok: boolean;
  message?: string;
}
export interface BulkResult {
  bulkId: string;
  writtenOff: number;
  refused: number;
  results: BulkItemResult[];
}

export async function bulkWriteOff(actor: Actor | null, input: unknown, now = new Date()): Promise<Result<BulkResult>> {
  if (!actor) return unauthenticated("bulk_write_off");
  const once = (fn: (w: Writer) => Promise<Refusal>) => inWrite<BulkResult>(actor, "bulk_write_off", null, fn);
  if (!can(actor, "decision:propose")) return once((w) => w.refuse("ROLE_NOT_ALLOWED"));
  const parsed = BulkWriteOffInput.safeParse(input);
  const ids = parsed.success ? parsed.data.ids : [];
  if (!parsed.success || new Set(ids).size !== ids.length) {
    return once((w) => w.refuse("INVALID_INPUT", { message: `Select between 1 and ${BULK_MAX} different cases.` }));
  }
  const { note } = parsed.data;
  if (hasCardNumber(note, ...ids)) return once((w) => w.refuse("CARD_NUMBER"));
  if (!isValidNote(note)) return once((w) => w.refuse("NOTE_TOO_SHORT", { note }));

  const bulkId = randomUUID();
  const results: BulkItemResult[] = [];
  for (const id of ids) {
    const r = await inWrite(actor, "bulk_write_off", id, (w) => {
      w.bulkId = bulkId;
      return proposeIn(w, id, { decisionType: "ACCEPT_LOSS_WRITE_OFF", note }, now);
    });
    results.push(r.ok ? { id, ok: true } : { id, ok: false, message: r.message });
  }
  const writtenOff = results.filter((r) => r.ok).length;
  return ok({ bulkId, writtenOff, refused: results.length - writtenOff, results });
}

// ---------- Import (R10) ----------

export type ImportRowResult = "VALID" | "IMPORTED" | "REJECTED" | "DUPLICATE" | "REPRESENTMENT";

export interface ImportRowView {
  rowNumber: number;
  caseId: string | null;
  result: ImportRowResult;
  reasons: string[];
  row: {
    client: string;
    merchant: string;
    cardLast4: string;
    amountCents: number;
    currency: string;
    reasonCode: string;
    dueAt: string;
    hasMerchantResponse: boolean;
  } | null;
}

export interface ImportResult {
  dryRun: boolean;
  batchId: string | null;
  imported: number;
  rejected: number;
  duplicates: number;
  /** Rows that carried a merchant response for an existing filed case (R10). */
  representments: number;
  rows: ImportRowView[];
}

function previewOf(row: ValidDisputeRow): NonNullable<ImportRowView["row"]> {
  return {
    client: row.client,
    merchant: row.merchant,
    cardLast4: row.cardLast4,
    amountCents: row.amountCents,
    currency: row.currency,
    reasonCode: row.reasonCode,
    dueAt: row.dueAt.toISOString(),
    hasMerchantResponse: row.merchantResponse !== null,
  };
}

function batchIdFor(now: Date): string {
  return `IMP-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

/** Previews (dryRun) or imports the daily disputes file. One history row per batch. */
export async function importDisputes(actor: Actor | null, input: unknown, now = new Date()): Promise<Result<ImportResult>> {
  return inWrite<ImportResult>(actor, "import", null, async (w) => {
    if (!can(w.actor, "dispute:import")) return w.refuse("ROLE_NOT_ALLOWED");
    const parsed = ImportInput.safeParse(input);
    if (!parsed.success) return w.refuse("INVALID_INPUT", { message: "Choose a CSV file to import." });
    const { csv, dryRun = false } = parsed.data;
    const filename = parsed.data.filename?.trim() || "upload.csv";
    if (hasCardNumber(filename)) return w.refuse("CARD_NUMBER");

    const file = parseDisputeFile(csv);
    if (!file.ok) return w.refuse("INVALID_INPUT", { message: file.error, after: { filename } });

    const candidateIds = file.rows.flatMap((r) => (r.valid ? [r.row.caseId] : []));
    const existing = new Map(
      (await w.tx.dispute.findMany({ where: { id: { in: candidateIds } }, select: { id: true, status: true, dueAt: true } })).map(
        (d) => [d.id, d],
      ),
    );

    const seen = new Set<string>();
    const rows: ImportRowView[] = [];
    const toCreate: ValidDisputeRow[] = [];
    const toRepresent: { id: string; dueAt: Date; merchantResponse: string }[] = [];
    for (const r of file.rows) {
      const current = r.valid ? existing.get(r.row.caseId) : undefined;
      if (!r.valid) {
        rows.push({ rowNumber: r.rowNumber, caseId: r.caseId, result: "REJECTED", reasons: r.reasons, row: null });
      } else if (current && r.row.merchantResponse !== null && current.status === "CHARGEBACK_FILED" && !seen.has(current.id)) {
        // The daily file also carries merchant responses for cases already filed: record the representment (R10).
        seen.add(current.id);
        if (isPastDeadline(current.dueAt, now)) {
          rows.push({ rowNumber: r.rowNumber, caseId: current.id, result: "REJECTED", reasons: ["case is past its network deadline"], row: null });
        } else {
          toRepresent.push({ id: current.id, dueAt: current.dueAt, merchantResponse: r.row.merchantResponse });
          rows.push({ rowNumber: r.rowNumber, caseId: current.id, result: "REPRESENTMENT", reasons: [], row: previewOf(r.row) });
        }
      } else if (existing.has(r.row.caseId) || seen.has(r.row.caseId)) {
        rows.push({
          rowNumber: r.rowNumber,
          caseId: r.row.caseId,
          result: "DUPLICATE",
          reasons: [existing.has(r.row.caseId) ? "case already exists" : "repeated in this file"],
          row: previewOf(r.row),
        });
      } else {
        seen.add(r.row.caseId);
        toCreate.push(r.row);
        rows.push({
          rowNumber: r.rowNumber,
          caseId: r.row.caseId,
          result: dryRun ? "VALID" : "IMPORTED",
          reasons: [],
          row: previewOf(r.row),
        });
      }
    }
    const counts = {
      imported: toCreate.length,
      rejected: rows.filter((r) => r.result === "REJECTED").length,
      duplicates: rows.filter((r) => r.result === "DUPLICATE").length,
      representments: toRepresent.length,
    };
    if (dryRun) return ok({ dryRun: true, batchId: null, ...counts, rows });

    for (const row of toCreate) {
      const representment = row.merchantResponse !== null;
      await w.tx.dispute.create({
        data: {
          id: row.caseId,
          client: row.client,
          cardLast4: row.cardLast4,
          merchant: row.merchant,
          amountCents: row.amountCents,
          currency: row.currency,
          reasonCode: row.reasonCode,
          openedAt: row.openedAt ?? now,
          dueAt: row.dueAt,
          status: representment ? "REPRESENTMENT_RECEIVED" : "NEW",
          provisionalCreditCents: row.amountCents,
          merchantResponse: row.merchantResponse,
          representmentReceivedAt: representment ? now : null,
          evidence: { create: EVIDENCE_TEMPLATES[row.reasonCode].map((e) => ({ ...e })) },
        },
      });
    }
    const batchId = batchIdFor(now);
    const responseDueAt = addDays(now, RESPONSE_WINDOW_DAYS);
    for (const rep of toRepresent) {
      const claimed = await w.tx.dispute.updateMany({
        where: { id: rep.id, status: "CHARGEBACK_FILED" },
        data: { status: "REPRESENTMENT_RECEIVED", merchantResponse: rep.merchantResponse, representmentReceivedAt: now, dueAt: responseDueAt },
      });
      if (claimed.count !== 1) continue;
      await record(w.tx, {
        actor: w.actor,
        action: "representment_received",
        disputeId: rep.id,
        before: { status: "CHARGEBACK_FILED", dueAt: rep.dueAt.toISOString() },
        after: { status: "REPRESENTMENT_RECEIVED", dueAt: responseDueAt.toISOString(), batchId },
        note: rep.merchantResponse,
      });
    }
    await w.tx.importBatch.create({
      data: {
        id: batchId,
        actorId: w.actor.id,
        filename,
        createdAt: now,
        ...counts,
        rows: {
          create: rows.map((r) => ({
            rowNumber: r.rowNumber,
            caseId: r.caseId,
            result: r.result,
            reason: r.reasons.length > 0 ? r.reasons.join("; ") : null,
          })),
        },
      },
    });
    await record(w.tx, {
      actor: w.actor,
      action: "import_batch",
      after: { batchId, filename, ...counts },
    });
    return ok({ dryRun: false, batchId, ...counts, rows });
  });
}

// ---------- Simulated network events (dev only) ----------

/** Action 2: the merchant's representment arrives. */
export async function receiveRepresentment(
  actor: Actor,
  disputeId: unknown,
  input: unknown,
  now = new Date(),
): Promise<Result<DisputeView>> {
  return inWrite(actor, "representment", String(disputeId), async (w) => {
    const id = DisputeId.safeParse(disputeId);
    const d = id.success ? await w.tx.dispute.findUnique({ where: { id: id.data } }) : null;
    if (d) w.disputeId = d.id;
    if (!can(w.actor, "network:event")) return w.refuse("ROLE_NOT_ALLOWED");
    if (!d) return w.refuse("NOT_FOUND");
    const parsed = RepresentmentInput.safeParse(input);
    if (!parsed.success) return w.refuse("INVALID_INPUT", { message: "The merchant response text is required." });
    if (hasCardNumber(parsed.data.merchantResponse)) return w.refuse("CARD_NUMBER", { before: { status: d.status } });
    if (statusOf(d) !== "CHARGEBACK_FILED") {
      return w.refuse("INVALID_STATUS", { message: "Representments only apply to filed chargebacks.", before: { status: d.status } });
    }
    const dueAt = addDays(now, RESPONSE_WINDOW_DAYS);
    const claimed = await w.tx.dispute.updateMany({
      where: { id: d.id, status: "CHARGEBACK_FILED" },
      data: {
        status: "REPRESENTMENT_RECEIVED",
        merchantResponse: parsed.data.merchantResponse,
        representmentReceivedAt: now,
        dueAt,
      },
    });
    if (claimed.count !== 1) return w.refuse("INVALID_STATUS");
    await record(w.tx, {
      actor: w.actor,
      action: "representment_received",
      disputeId: d.id,
      before: { status: d.status, dueAt: d.dueAt.toISOString() },
      after: { status: "REPRESENTMENT_RECEIVED", dueAt: dueAt.toISOString() },
      note: parsed.data.merchantResponse,
    });
    return ok(await reload(w.tx, d.id));
  });
}

/** Action 5: the network rules on a pre-arbitration case. */
export async function recordRuling(actor: Actor, disputeId: unknown, input: unknown, now = new Date()): Promise<Result<DisputeView>> {
  return inWrite(actor, "ruling", String(disputeId), async (w) => {
    const id = DisputeId.safeParse(disputeId);
    const d = id.success ? await w.tx.dispute.findUnique({ where: { id: id.data } }) : null;
    if (d) w.disputeId = d.id;
    if (!can(w.actor, "network:event")) return w.refuse("ROLE_NOT_ALLOWED");
    if (!d) return w.refuse("NOT_FOUND");
    const parsed = RulingInput.safeParse(input);
    if (!parsed.success) return w.refuse("INVALID_INPUT", { message: "The ruling must be WON or LOST." });
    if (statusOf(d) !== "PRE_ARB_FILED") {
      return w.refuse("INVALID_STATUS", { message: "Rulings only apply to pre-arbitration cases.", before: { status: d.status } });
    }
    const status: Status = parsed.data.outcome === "WON" ? "CLOSED_WON" : "CLOSED_LOST";
    const claimed = await w.tx.dispute.updateMany({
      where: { id: d.id, status: "PRE_ARB_FILED" },
      // Backlog 9: with no provisional credit, the cardholder only gets the money after the win (BUSINESS_RULES §5).
      data: { status, updatedAt: now, ...(status === "CLOSED_WON" && d.provisionalCreditCents === 0 ? { fundsStatus: "FUNDS_NOT_YET_RECEIVED" } : {}) },
    });
    if (claimed.count !== 1) return w.refuse("INVALID_STATUS");
    await record(w.tx, {
      actor: w.actor,
      action: "ruling_recorded",
      disputeId: d.id,
      before: { status: d.status },
      after: { status, outcome: parsed.data.outcome },
    });
    return ok(await reload(w.tx, d.id));
  });
}

export const FilingRejectedInput = z.object({ reason: z.string().trim().min(1).max(500) });

/** Network event: the network rejects a filed chargeback (BUSINESS_RULES §1). Ops then reviews it. */
export async function rejectFiling(actor: Actor, disputeId: unknown, input: unknown, now = new Date()): Promise<Result<DisputeView>> {
  return inWrite(actor, "filing_rejected", String(disputeId), async (w) => {
    const id = DisputeId.safeParse(disputeId);
    const d = id.success ? await w.tx.dispute.findUnique({ where: { id: id.data } }) : null;
    if (d) w.disputeId = d.id;
    if (!can(w.actor, "network:event")) return w.refuse("ROLE_NOT_ALLOWED");
    if (!d) return w.refuse("NOT_FOUND");
    const parsed = FilingRejectedInput.safeParse(input);
    if (!parsed.success) return w.refuse("INVALID_INPUT", { message: "The network's rejection reason is required." });
    const reason = parsed.data.reason;
    if (hasCardNumber(reason)) return w.refuse("CARD_NUMBER", { before: { status: d.status } });
    if (statusOf(d) !== "CHARGEBACK_FILED") {
      return w.refuse("INVALID_STATUS", { message: "Only a filed chargeback can be rejected by the network.", before: { status: d.status } });
    }
    const dueAt = addDays(now, RESPONSE_WINDOW_DAYS);
    const claimed = await w.tx.dispute.updateMany({
      where: { id: d.id, status: "CHARGEBACK_FILED" },
      data: { status: "FILING_REJECTED", filingRejectedAt: now, filingRejectReason: reason, dueAt, updatedAt: now },
    });
    if (claimed.count !== 1) return w.refuse("INVALID_STATUS");
    await record(w.tx, {
      actor: w.actor,
      action: "filing_rejected",
      disputeId: d.id,
      before: { status: d.status },
      after: { status: "FILING_REJECTED", dueAt: dueAt.toISOString() },
      note: reason,
    });
    return ok(await reload(w.tx, d.id));
  });
}

export const NETWORK_ACTOR: Actor = { id: "network", name: "Card network (simulated)", role: "system" };

/* Backlog 9: funds tracking after a won dispute (BUSINESS_RULES §5). */

const FundsProposeInput = z.object({ move: z.enum(FUNDS_MOVES), note: Note });
const FundsRejectInput = z.object({ note: Note });

function fundsSnapshot(d: Dispute) {
  return { status: d.status, fundsStatus: d.fundsStatus, fundsPendingMove: d.fundsPendingMove, fundsProposedBy: d.fundsProposedBy };
}

async function loadTrackedFunds(w: Writer, rawId: unknown): Promise<Refusal | Dispute> {
  const id = DisputeId.safeParse(rawId);
  const d = id.success ? await w.tx.dispute.findUnique({ where: { id: id.data } }) : null;
  if (d) w.disputeId = d.id;
  if (!can(w.actor, ATTEMPT_PERMISSION[w.attempted])) return w.refuse("ROLE_NOT_ALLOWED", { message: ROLE_MESSAGES[w.attempted], ...(d ? { before: fundsSnapshot(d) } : {}) });
  if (!d) return w.refuse("NOT_FOUND");
  if (d.status !== "CLOSED_WON" || d.fundsStatus === null) {
    return w.refuse("INVALID_STATUS", {
      message:
        d.status === "CLOSED_WON"
          ? "This case had a provisional credit, so the win made it final. There are no funds to track."
          : "Funds are only tracked on won cases.",
      before: fundsSnapshot(d),
    });
  }
  return d;
}

async function moveFunds(w: Writer, d: Dispute, to: FundsStatus, action: HistoryAction, data: Prisma.DisputeUpdateManyMutationInput, note: string | null = null) {
  const moved = await w.tx.dispute.updateMany({
    where: { id: d.id, fundsStatus: d.fundsStatus, fundsPendingMove: d.fundsPendingMove },
    data: { fundsStatus: to, ...data },
  });
  if (moved.count !== 1) return w.refuse("ALREADY_DECIDED", { message: "These funds changed; reload and try again.", before: fundsSnapshot(d) });
  const after = await w.tx.dispute.findUniqueOrThrow({ where: { id: d.id } });
  await record(w.tx, { actor: w.actor, action, disputeId: d.id, before: fundsSnapshot(d), after: fundsSnapshot(after), note });
  return ok(toDisputeView(after));
}

/** Network event: the acquirer's funds arrive. Parked time starts now. */
export async function recordFundsReceived(actor: Actor, disputeId: unknown, now = new Date()): Promise<Result<DisputeView>> {
  return inWrite(actor, "funds_received", String(disputeId), async (w) => {
    const d = await loadTrackedFunds(w, disputeId);
    if (isRefusal(d)) return d;
    if (d.fundsStatus !== "FUNDS_NOT_YET_RECEIVED") return w.refuse("INVALID_STATUS", { message: "These funds were already received.", before: fundsSnapshot(d) });
    return moveFunds(w, d, "FUNDS_RECEIVED_FROM_ACQUIRER", "funds_received", { fundsReceivedAt: now, updatedAt: now });
  });
}

/** Internal ledger step; no maker-checker (only moving money to the cardholder or reversing it needs one). */
export async function creditProgram(actor: Actor | null, disputeId: unknown, now = new Date()): Promise<Result<DisputeView>> {
  return inWrite(actor, "funds_program", String(disputeId), async (w) => {
    const d = await loadTrackedFunds(w, disputeId);
    if (isRefusal(d)) return d;
    if (d.fundsPendingMove) return w.refuse("INVALID_STATUS", { message: "A funds move is waiting for approval.", before: fundsSnapshot(d) });
    if (d.fundsStatus !== "FUNDS_RECEIVED_FROM_ACQUIRER") {
      return w.refuse("INVALID_STATUS", { message: "Only funds received from the acquirer can be credited to the program.", before: fundsSnapshot(d) });
    }
    return moveFunds(w, d, "FUNDS_CREDITED_TO_PROGRAM", "funds_credited_to_program", { updatedAt: now });
  });
}

/** Maker step (R4, R6): propose crediting the cardholder or reversing the funds. Always needs a different lead. */
export async function proposeFundsMove(actor: Actor | null, disputeId: unknown, input: unknown, now = new Date()): Promise<Result<DisputeView>> {
  return inWrite(actor, "funds_propose", String(disputeId), async (w) => {
    const d = await loadTrackedFunds(w, disputeId);
    if (isRefusal(d)) return d;
    const parsed = FundsProposeInput.safeParse(input);
    if (!parsed.success) return w.refuse("INVALID_INPUT", { message: "Choose to credit the cardholder or reverse the funds, and add a note.", before: fundsSnapshot(d) });
    const { move, note } = parsed.data;
    if (hasCardNumber(note)) return w.refuse("CARD_NUMBER", { before: fundsSnapshot(d) });
    if (d.fundsPendingMove) return w.refuse("INVALID_STATUS", { message: "A funds move is already waiting for approval.", before: fundsSnapshot(d), note });
    const allowed = FUNDS_MOVE_FROM[move].includes(d.fundsStatus as FundsStatus);
    if (!allowed) {
      return w.refuse("INVALID_STATUS", {
        message: move === "CREDIT_CARDHOLDER" ? "Credit the funds to the program before crediting the cardholder." : "Only received funds that haven't been settled can be reversed.",
        before: fundsSnapshot(d),
        note,
      });
    }
    if (!isValidNote(note)) return w.refuse("NOTE_TOO_SHORT", { before: fundsSnapshot(d), note });
    const claimed = await w.tx.dispute.updateMany({
      where: { id: d.id, fundsStatus: d.fundsStatus, fundsPendingMove: null },
      data: { fundsPendingMove: move, fundsProposedBy: w.actor.id, fundsProposalNote: note.trim(), updatedAt: now },
    });
    if (claimed.count !== 1) return w.refuse("INVALID_STATUS", { message: "These funds changed; reload and try again." });
    const after = await w.tx.dispute.findUniqueOrThrow({ where: { id: d.id } });
    await record(w.tx, { actor: w.actor, action: "funds_move_proposed", disputeId: d.id, before: fundsSnapshot(d), after: fundsSnapshot(after), note: note.trim() });
    return ok(toDisputeView(after));
  });
}

async function checkFundsDecision(w: Writer, d: Dispute): Promise<Refusal | null> {
  if (!d.fundsPendingMove) return w.refuse("INVALID_STATUS", { message: "There's no funds move waiting for approval.", before: fundsSnapshot(d) });
  if (d.fundsProposedBy === w.actor.id) {
    return w.refuse("SELF_APPROVAL_BLOCKED", {
      action: "decision_blocked",
      message: "You proposed this funds move; a different lead must approve or reject it.",
      before: fundsSnapshot(d),
    });
  }
  return null;
}

/** Checker step (R4): a lead who didn't propose it. */
export async function approveFundsMove(actor: Actor | null, disputeId: unknown, input: unknown, now = new Date()): Promise<Result<DisputeView>> {
  return inWrite(actor, "funds_approve", String(disputeId), async (w) => {
    const d = await loadTrackedFunds(w, disputeId);
    if (isRefusal(d)) return d;
    const blocked = await checkFundsDecision(w, d);
    if (blocked) return blocked;
    const parsed = ApproveInput.safeParse(input);
    if (!parsed.success) return w.refuse("INVALID_INPUT", { before: fundsSnapshot(d) });
    const comment = parsed.data?.comment?.trim() || null;
    if (hasCardNumber(comment)) return w.refuse("CARD_NUMBER", { before: fundsSnapshot(d) });
    const to: FundsStatus = d.fundsPendingMove === "REVERSE" ? "FUNDS_REVERSED" : "FUNDS_CREDITED_TO_CARDHOLDER";
    return moveFunds(w, d, to, "funds_move_approved", { fundsPendingMove: null, fundsSettledAt: now, fundsDecidedBy: w.actor.id, updatedAt: now }, comment);
  });
}

export async function rejectFundsMove(actor: Actor | null, disputeId: unknown, input: unknown, now = new Date()): Promise<Result<DisputeView>> {
  return inWrite(actor, "funds_reject", String(disputeId), async (w) => {
    const d = await loadTrackedFunds(w, disputeId);
    if (isRefusal(d)) return d;
    const blocked = await checkFundsDecision(w, d);
    if (blocked) return blocked;
    const parsed = FundsRejectInput.safeParse(input);
    const note = parsed.success ? parsed.data.note : "";
    if (hasCardNumber(note)) return w.refuse("CARD_NUMBER", { before: fundsSnapshot(d) });
    if (!isValidNote(note)) return w.refuse("NOTE_TOO_SHORT", { before: fundsSnapshot(d), note: note || null });
    return moveFunds(w, d, d.fundsStatus as FundsStatus, "funds_move_rejected", { fundsPendingMove: null, fundsProposedBy: null, fundsProposalNote: null, updatedAt: now }, note.trim());
  });
}
