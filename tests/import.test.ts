import { beforeAll, describe, expect, it } from "vitest";
import { importDisputes } from "@/server/disputes/service";
import { prisma } from "@/server/db";
import { containsCardNumber } from "@/server/import";
import { buildSampleCsv } from "@/server/sample";
import { seedDb, users } from "./helpers";

beforeAll(seedDb);

describe("R10 import", () => {
  it("the import rejects a full card number and a missing amount, imports the rest, and sends merchant_response rows to REPRESENTMENT_RECEIVED (R10)", async () => {
    const csv = buildSampleCsv();
    const preview = await importDisputes(users.ana, { csv, dryRun: true });
    expect(preview).toMatchObject({ ok: true, value: { imported: 12, rejected: 2, duplicates: 0, batchId: null } });
    expect(await prisma.dispute.count({ where: { id: { startsWith: "CB-20" } } })).toBe(0);

    const r = await importDisputes(users.ana, { csv, filename: "disputes-today.csv" });
    if (!r.ok) throw new Error(r.message);
    expect(r.value).toMatchObject({ imported: 12, rejected: 2, duplicates: 0 });
    const rejected = r.value.rows.filter((x) => x.result === "REJECTED");
    expect(rejected.map((x) => [x.caseId, x.reasons])).toEqual([
      ["CB-2013", ["contains a full card number"]],
      ["CB-2014", ["missing amount"]],
    ]);
    const reps = await prisma.dispute.findMany({ where: { status: "REPRESENTMENT_RECEIVED", id: { startsWith: "CB-20" } } });
    expect(reps.map((d) => d.id).sort()).toEqual(["CB-2011", "CB-2012"]);
    const created = await prisma.dispute.findUniqueOrThrow({ where: { id: "CB-2004" }, include: { evidence: true } });
    expect(created).toMatchObject({ status: "NEW", amountCents: 118000, provisionalCreditCents: 118000 });
    expect(created.evidence.length).toBeGreaterThan(0);

    const stored = JSON.stringify(await prisma.importRow.findMany()) + JSON.stringify(await prisma.dispute.findMany());
    expect(stored).not.toMatch(/4111/);
    const batchRows = await prisma.history.findMany({ where: { action: "import_batch" } });
    expect(batchRows).toHaveLength(1);
    expect(JSON.parse(batchRows[0].after ?? "{}")).toMatchObject({ imported: 12, rejected: 2, duplicates: 0 });
  });

  it("a case_id that already exists is recorded as DUPLICATE (R10)", async () => {
    const r = await importDisputes(users.carla, { csv: buildSampleCsv() });
    expect(r).toMatchObject({ ok: true, value: { imported: 0, rejected: 2, duplicates: 12 } });
  });

  it("rejects invalid fields and card fields that aren't exactly 4 digits (R10)", async () => {
    const header = "case_id,client,card_last4,merchant,amount,currency,reason_code,opened_at,due_at,merchant_response";
    const csv = [
      header,
      "CB-9001,Norte Bank,12345,Amazon,10.00,USD,FRAUD,,2099-01-01T00:00:00Z,",
      "CB-9002,Norte Bank,1234,Amazon,ten,USD,FRAUD,,2099-01-01T00:00:00Z,",
      "CB-9003,Norte Bank,1234,Amazon,10.00,US,FRAUD,,2099-01-01T00:00:00Z,",
      "CB-9004,Norte Bank,1234,Amazon,10.00,USD,OTHER,,2099-01-01T00:00:00Z,",
      "CB-9005,Norte Bank,1234,Amazon,10.00,USD,FRAUD,,tomorrow,",
      "CB-9006,Norte Bank,1234,Amazon,10.00,USD,FRAUD,,2099-01-01,",
    ].join("\n");
    const r = await importDisputes(users.ana, { csv, dryRun: true });
    if (!r.ok) throw new Error(r.message);
    expect(r.value.rows.map((x) => x.reasons)).toEqual([
      ["card field must be exactly 4 digits"],
      ["invalid amount"],
      ["invalid currency"],
      ["invalid reason_code"],
      ["invalid due_at"],
      [],
    ]);
  });

  it("detects Luhn-valid card numbers with separators and ignores ones that fail Luhn (R10)", () => {
    expect(containsCardNumber("pay 4111-1111-1111-1111 ok")).toBe(true);
    expect(containsCardNumber("5500005555555559")).toBe(true);
    expect(containsCardNumber("order 4111111111111112")).toBe(false);
    expect(containsCardNumber("1240.00")).toBe(false);
  });
});
