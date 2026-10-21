import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { getCase, getQueue, listHistory } from "@/server/disputes/queries";
import {
  NETWORK_ACTOR,
  approveDecision,
  attachEvidenceFile,
  bulkWriteOff,
  editMemo,
  fileChargeback,
  importDisputes,
  proposeDecision,
  receiveRepresentment,
  rejectDecision,
  setEvidence,
} from "@/server/disputes/service";
import { exportHistory, exportQueue } from "@/server/export";
import { record } from "@/server/history";
import { containsCardNumber } from "@/server/import";
import { makeCase, seedDb, users } from "./helpers";

/** Backlog 6: no full card number can be stored, returned or exported, whatever a client sends. */
const PANS = ["4111111111111111", "4111 1111 1111 1111", "5500-0000-0000-0004", "378282246310005"];
const returned: unknown[] = [];
const keep = <T>(r: T): T => (returned.push(r), r);

const HEADER = "case_id,client,card_last4,merchant,amount,currency,reason_code,opened_at,due_at,merchant_response";
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4\n${text}\n%%EOF`);

async function storedStrings(): Promise<{ where: string; value: string }[]> {
  const tables = await prisma.$queryRawUnsafe<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'",
  );
  const out: { where: string; value: string }[] = [];
  for (const { name } of tables) {
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "${name}"`);
    for (const row of rows) for (const [col, v] of Object.entries(row)) if (typeof v === "string") out.push({ where: `${name}.${col}`, value: v });
  }
  return out;
}

function uploadedFiles(dir = path.resolve(process.env.UPLOAD_DIR ?? "uploads")): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((e) => {
    const full = path.join(dir, e);
    return statSync(full).isDirectory() ? uploadedFiles(full) : [full];
  });
}

beforeAll(seedDb);

describe("card number audit (backlog 6)", () => {
  it("every write path refuses a full card number in any free-text field", async () => {
    for (const pan of PANS) {
      const text = `Cardholder used ${pan} at the store`;

      const csv = [
        HEADER,
        `X-${returned.length}-1,Norte Bank,4821,${pan},10.00,USD,FRAUD,${day(-2)},${day(5)},`,
        `X-${returned.length}-2,${pan},4821,Amazon,10.00,USD,FRAUD,${day(-2)},${day(5)},`,
        `X-${returned.length}-3,Norte Bank,${pan},Amazon,10.00,USD,FRAUD,${day(-2)},${day(5)},`,
        `X-${returned.length}-4,Norte Bank,4821,Amazon,10.00,USD,FRAUD,${day(-2)},${day(5)},"${text}"`,
        `${pan.replace(/\D/g, "")},Norte Bank,4821,Amazon,10.00,USD,FRAUD,${day(-2)},${day(5)},`,
      ].join("\n");
      const imp = keep(await importDisputes(users.ana, { csv, dryRun: false }));
      expect(imp.ok && imp.value.imported).toBe(0);
      expect(keep(await importDisputes(users.ana, { csv: `${HEADER}\n`, filename: `${pan}.csv` }))).toMatchObject({ ok: false, code: "CARD_NUMBER" });

      const rr = await makeCase({ status: "REPRESENTMENT_RECEIVED", amountCents: 2000 });
      expect(keep(await proposeDecision(users.ana, rr.id, { decisionType: "ACCEPT_LOSS_WRITE_OFF", note: text }))).toMatchObject({ code: "CARD_NUMBER" });
      expect(keep(await proposeDecision(users.ana, rr.id, { decisionType: "ESCALATE_PRE_ARB", note: "Fight it, strong case.", memo: text }))).toMatchObject({ ok: false });
      expect(keep(await bulkWriteOff(users.ana, { ids: [rr.id], note: text }))).toMatchObject({ code: "CARD_NUMBER" });
      expect(keep(await bulkWriteOff(users.ana, { ids: [pan], note: "Small amounts, not worth it." }))).toMatchObject({ ok: false });

      const pending = await makeCase({ status: "DECISION_PENDING", decisionType: "ACCEPT_LOSS_WRITE_OFF", proposedBy: "u_carla", amountCents: 90000 });
      expect(keep(await approveDecision(users.eve, pending.id, { comment: text }))).toMatchObject({ code: "CARD_NUMBER" });
      expect(keep(await rejectDecision(users.eve, pending.id, { note: text }))).toMatchObject({ code: "CARD_NUMBER" });
      expect(keep(await rejectDecision(users.carla, pending.id, { note: text }))).toMatchObject({ code: "CARD_NUMBER" });

      const esc = await makeCase({ status: "REPRESENTMENT_RECEIVED", amountCents: 90000 });
      expect((await proposeDecision(users.ana, esc.id, { decisionType: "ESCALATE_PRE_ARB", note: "Fight it, strong case." })).ok).toBe(true);
      expect(keep(await editMemo(users.ana, esc.id, { memo: text }))).toMatchObject({ ok: false });

      const filed = await makeCase({ status: "CHARGEBACK_FILED" });
      expect(keep(await receiveRepresentment(NETWORK_ACTOR, filed.id, { merchantResponse: text }))).toMatchObject({ code: "CARD_NUMBER" });

      const fresh = await makeCase({ status: "NEW" });
      keep(await setEvidence(users.ana, fresh.id, { key: pan.slice(0, 40), checked: true }));
      keep(await attachEvidenceFile(users.ana, fresh.id, { key: "cardholder_statement", filename: `${pan}.pdf`, bytes: pdf("ok") }));
      keep(await attachEvidenceFile(users.ana, fresh.id, { key: "cardholder_statement", filename: "statement.pdf", bytes: pdf(text) }));
      keep(await fileChargeback(users.ana, pan));
      keep(await proposeDecision(users.ana, pan, { decisionType: "ACCEPT_LOSS_WRITE_OFF", note: text }));
    }
  });

  it("nothing stored in any table or upload holds a full card number", async () => {
    const all = await storedStrings();
    expect(all.length).toBeGreaterThan(200);
    expect(all.filter((s) => containsCardNumber(s.value)).map((s) => s.where)).toEqual([]);
    for (const f of uploadedFiles()) expect(containsCardNumber(readFileSync(f).toString("latin1")), f).toBe(false);
    expect(await prisma.history.count({ where: { after: { contains: '"code":"CARD_NUMBER"' } } })).toBeGreaterThanOrEqual(PANS.length * 6);
  });

  it("nothing returned by a write, read or export holds a full card number", async () => {
    const cases = await prisma.dispute.findMany({ select: { id: true } });
    for (const c of cases) keep(await getCase(users.dan, c.id));
    keep(await getQueue(users.dan, {}));
    keep(await listHistory(users.dan, {}, null));
    const q = await exportQueue(users.dan, {});
    const h = await exportHistory(users.dan, {});
    expect(q.ok && h.ok).toBe(true);
    keep(q);
    keep(h);
    const leaks = returned.map((r) => JSON.stringify(r)).filter(containsCardNumber);
    expect(leaks).toEqual([]);
  });

  it("History itself scrubs a card number that a caller failed to refuse", async () => {
    await prisma.$transaction((tx) =>
      record(tx, { actor: users.ana, action: "action_refused", before: { nested: [`x ${PANS[0]}`] }, after: { v: PANS[1] }, note: PANS[2] }),
    );
    const row = await prisma.history.findFirstOrThrow({ orderBy: { id: "desc" } });
    expect(containsCardNumber(`${row.before}${row.after}${row.note}`)).toBe(false);
    expect(row.note).toBe("[card number removed]");
  });
});
