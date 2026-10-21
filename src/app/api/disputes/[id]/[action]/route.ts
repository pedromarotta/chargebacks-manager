import {
  approveDecision,
  approveFundsMove,
  creditProgram,
  proposeFundsMove,
  rejectFundsMove,
  editMemo,
  fileChargeback,
  proposeDecision,
  rejectDecision,
  setEvidence,
} from "@/server/disputes/service";
import type { Actor } from "@/server/domain";
import type { Result } from "@/server/errors";
import { handleJson, notFound } from "@/server/http";

type Handler = (actor: Actor, id: string, body: unknown) => Promise<Result<unknown>>;

const ACTIONS: Record<string, Handler> = {
  file: (actor, id) => fileChargeback(actor, id),
  propose: (actor, id, body) => proposeDecision(actor, id, body),
  approve: (actor, id, body) => approveDecision(actor, id, body),
  reject: (actor, id, body) => rejectDecision(actor, id, body),
  evidence: (actor, id, body) => setEvidence(actor, id, body),
  memo: (actor, id, body) => editMemo(actor, id, body),
  "funds-program": (actor, id) => creditProgram(actor, id),
  "funds-propose": (actor, id, body) => proposeFundsMove(actor, id, body),
  "funds-approve": (actor, id, body) => approveFundsMove(actor, id, body),
  "funds-reject": (actor, id, body) => rejectFundsMove(actor, id, body),
};

export async function POST(req: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  const handler = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : undefined;
  if (!handler) return notFound();
  return handleJson(req, async (actor, body) => {
    const result = await handler(actor, id, body);
    return result.ok ? { ok: true, value: { dispute: result.value } } : result;
  });
}
