import { getCurrentUser } from "@/server/auth";
import { QUEUE_TABS, type QueueTab } from "@/server/disputes/queries";
import { exportQueue } from "@/server/export";
import { csvResponse } from "@/server/export-response";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const tab = sp.get("tab") ?? "all";
  if (!(QUEUE_TABS as readonly string[]).includes(tab)) return csvResponse({ ok: false, code: "INVALID_INPUT", message: "Unknown queue tab.", httpStatus: 400 });
  const client = sp.get("client")?.trim().slice(0, 120) || null;
  return csvResponse(await exportQueue(await getCurrentUser(), { tab: tab as QueueTab, client }));
}
