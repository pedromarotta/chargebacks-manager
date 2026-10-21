import { beforeAll, describe, expect, it, vi } from "vitest";
import { GET as historyRoute } from "@/app/api/export/history/route";
import { GET as queueRoute } from "@/app/api/export/queue/route";
import { signSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { proposeDecision } from "@/server/disputes/service";
import { centsToDecimal, csvCell, exportHistory, exportQueue, toCsv } from "@/server/export";
import { makeCase, seedDb, users } from "./helpers";

const cookieJar = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieJar.value ? { name: "cbm_session", value: cookieJar.value } : undefined) }),
}));

beforeAll(seedDb);

const parse = (csv: string) => csv.trimEnd().split("\r\n");

describe("CSV export (backlog 5)", () => {
  it("quotes, neutralizes formulas and redacts card numbers", () => {
    expect(csvCell('He said "hi", then left')).toBe('"He said ""hi"", then left"');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("card 4111 1111 1111 1111 used")).toBe("card [card number removed] used");
    expect(csvCell("ending 4417")).toBe("ending 4417");
    expect(csvCell(null)).toBe("");
    expect(toCsv(["a", "b"], [[1, "x,y"]])).toBe('a,b\r\n1,"x,y"\r\n');
    expect([centsToDecimal(124000), centsToDecimal(5), centsToDecimal(0), centsToDecimal(null)]).toEqual(["1240.00", "0.05", "0.00", ""]);
  });

  it("auditor exports the queue with the current filter; money as decimals; the export is logged", async () => {
    const c = await makeCase({ status: "REPRESENTMENT_RECEIVED", amountCents: 123456 });
    const r = await exportQueue(users.dan, { tab: "representment" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lines = parse(r.value.csv);
    expect(lines[0]).toMatch(/^case_id,client,card_last4,merchant,amount,currency,reason_code,status,/);
    const row = lines.find((l) => l.startsWith(c.id + ","));
    expect(row).toContain(",1234.56,USD,");
    expect(lines.slice(1).every((l) => l.includes("REPRESENTMENT_RECEIVED"))).toBe(true);
    expect(r.value.rows).toBe(lines.length - 1);
    const log = await prisma.history.findFirstOrThrow({ where: { action: "data_exported", actorId: "u_dan" }, orderBy: { id: "desc" } });
    expect(JSON.parse(log.after ?? "{}")).toMatchObject({ kind: "queue", rows: r.value.rows, filters: { tab: "representment" } });
  });

  it("auditor exports the full history, beyond the 1000 rows the page shows", async () => {
    const c = await makeCase({ status: "REPRESENTMENT_RECEIVED", amountCents: 1000 });
    await proposeDecision(users.ana, c.id, { decisionType: "ACCEPT_LOSS_WRITE_OFF", note: "tiny" });
    const r = await exportHistory(users.dan, { disputeId: c.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lines = parse(r.value.csv);
    expect(lines[0]).toBe("id,at,actor_id,actor_role,action,case_id,summary,changes,note,before,after");
    expect(lines[1]).toContain("action_refused");
    expect(lines[1]).toContain("tiny");
    const all = await exportHistory(users.dan, {});
    expect(all.ok && all.value.rows).toBe(await prisma.history.count() - 1);
  });

  it("only auditors can export", async () => {
    for (const u of [users.ana, users.carla]) {
      expect(await exportQueue(u, {})).toMatchObject({ ok: false, code: "ROLE_NOT_ALLOWED" });
      expect(await exportHistory(u, {})).toMatchObject({ ok: false, code: "ROLE_NOT_ALLOWED" });
    }
    expect(await exportQueue(null, {})).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("routes: CSV attachment for the auditor, 401 / 403 / 400 otherwise", async () => {
    const req = (path: string) => new Request(`http://x${path}`);
    cookieJar.value = signSession("u_dan");
    const res = await queueRoute(req("/api/export/queue?tab=closed"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="disputes-queue-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect((await historyRoute(req("/api/export/history?kind=refusals"))).status).toBe(200);
    expect((await historyRoute(req("/api/export/history?kind=nope"))).status).toBe(400);
    cookieJar.value = signSession("u_ana");
    expect((await queueRoute(req("/api/export/queue"))).status).toBe(403);
    cookieJar.value = undefined;
    expect((await historyRoute(req("/api/export/history"))).status).toBe(401);
  });
});
