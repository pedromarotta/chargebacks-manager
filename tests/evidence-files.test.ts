import { existsSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { getEvidenceFile } from "@/server/disputes/queries";
import { attachEvidenceFile } from "@/server/disputes/service";
import { sniffType, uploadDir } from "@/server/files";
import { historyFor, makeCase, seedDb, users } from "./helpers";

beforeAll(seedDb);

const pdf = (text = "affidavit") => new TextEncoder().encode(`%PDF-1.4\n${text}\n%%EOF`);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const storedCount = () => (existsSync(uploadDir()) ? readdirSync(uploadDir()).length : 0);

async function caseWithKey(status: "NEW" | "CLOSED_LOST" = "NEW") {
  const c = await makeCase({ status });
  const item = await prisma.evidenceItem.findFirstOrThrow({ where: { disputeId: c.id } });
  return { c, key: item.key, label: item.label };
}

describe("evidence files (backlog 2)", () => {
  it("stores the file under a random key, records metadata and one history row, and downloads it back", async () => {
    const { c, key, label } = await caseWithKey();
    const before = (await historyFor(c.id)).length;
    const r = await attachEvidenceFile(users.ana, c.id, { key, filename: "../../etc/affidavit.pdf", bytes: pdf() });
    expect(r).toMatchObject({ ok: true, value: { filename: "affidavit.pdf", contentType: "application/pdf", uploadedBy: "u_ana" } });
    if (!r.ok) return;

    const row = await prisma.evidenceFile.findUniqueOrThrow({ where: { id: r.value.id } });
    expect(row.storageKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(existsSync(`${uploadDir()}/${row.storageKey}`)).toBe(true);

    const h = await historyFor(c.id);
    expect(h).toHaveLength(before + 1);
    expect(h.at(-1)).toMatchObject({ action: "evidence_file_attached", actorId: "u_ana" });
    expect(h.at(-1)?.after).toContain(`"label":"${label}"`);

    // Auditors can read files; downloads are scoped to the case.
    const got = await getEvidenceFile(users.dan, c.id, String(r.value.id));
    expect(got.ok && Buffer.from(got.value.bytes).equals(Buffer.from(pdf()))).toBe(true);
    expect(await getEvidenceFile(users.dan, "OTHER-CASE", String(r.value.id))).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await getEvidenceFile(null, c.id, String(r.value.id))).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("refuses auditors, closed cases, unknown items, wrong types, oversize and empty files, each with a history row and nothing stored", async () => {
    const { c, key } = await caseWithKey();
    const closed = await caseWithKey("CLOSED_LOST");
    const startFiles = storedCount();
    const startHistory = await prisma.history.count({ where: { action: "action_refused" } });

    const cases: [unknown, unknown, string][] = [
      [users.dan, { key, filename: "a.pdf", bytes: pdf() }, "ROLE_NOT_ALLOWED"],
      [users.ana, { key: closed.key, filename: "a.pdf", bytes: pdf() }, "INVALID_STATUS"],
      [users.ana, { key: "nope", filename: "a.pdf", bytes: pdf() }, "NOT_FOUND"],
      [users.ana, { key, filename: "a.pdf", bytes: new TextEncoder().encode("<html>not a pdf</html>") }, "INVALID_INPUT"],
      [users.ana, { key, filename: "a.pdf", bytes: new Uint8Array(5 * 1024 * 1024 + 1).fill(0x25) }, "INVALID_INPUT"],
      [users.ana, { key, filename: "a.pdf", bytes: new Uint8Array() }, "INVALID_INPUT"],
      [users.ana, { key }, "INVALID_INPUT"],
    ];
    for (const [actor, input, code] of cases) {
      const target = code === "INVALID_STATUS" ? closed.c.id : c.id;
      const r = await attachEvidenceFile(actor as typeof users.ana, target, input);
      expect(r, code).toMatchObject({ ok: false, code });
    }
    expect(storedCount()).toBe(startFiles);
    expect(await prisma.history.count({ where: { action: "action_refused" } })).toBe(startHistory + cases.length);
    expect(await prisma.evidenceFile.count({ where: { disputeId: { in: [c.id, closed.c.id] } } })).toBe(0);
  });

  it("refuses files with a full card number in the name or text, and never records the number", async () => {
    const { c, key } = await caseWithKey();
    const pan = "4111 1111 1111 1111";
    for (const input of [
      { key, filename: "statement.pdf", bytes: pdf(`Card ${pan}`) },
      { key, filename: "4111111111111111.png", bytes: png },
    ]) {
      expect(await attachEvidenceFile(users.ana, c.id, input)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
    const rows = await historyFor(c.id);
    expect(rows.map((r) => `${r.before}${r.after}${r.note}`).join("")).not.toMatch(/4111\s?1111/);
    // Last 4 only is fine.
    expect(await attachEvidenceFile(users.ana, c.id, { key, filename: "statement.pdf", bytes: pdf("Card ending 1111") })).toMatchObject({ ok: true });
  });

  it("detects the type from the bytes", () => {
    expect(sniffType(pdf())).toBe("application/pdf");
    expect(sniffType(png)).toBe("image/png");
    expect(sniffType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffType(new TextEncoder().encode("GIF89a"))).toBeNull();
  });
});
