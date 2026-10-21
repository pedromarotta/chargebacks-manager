import { getCurrentUser } from "@/server/auth";
import { HISTORY_FILTERS, type HistoryFilter } from "@/server/disputes/queries";
import { exportHistory } from "@/server/export";
import { csvResponse } from "@/server/export-response";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const kind = sp.get("kind") ?? "all";
  if (!(HISTORY_FILTERS as readonly string[]).includes(kind)) return csvResponse({ ok: false, code: "INVALID_INPUT", message: "Unknown history filter.", httpStatus: 400 });
  const actorId = sp.get("actor")?.trim().slice(0, 64) || null;
  const disputeId = sp.get("case")?.trim().slice(0, 64) || null;
  return csvResponse(await exportHistory(await getCurrentUser(), { kind: kind as HistoryFilter, actorId, disputeId }));
}
