import { beforeAll, describe, expect, it, vi } from "vitest";
import { approveDecision, fileChargeback, importDisputes, proposeDecision } from "@/server/disputes/service";
import { can } from "@/server/policy";
import { historyFor, makeCase, networkCallsFor, seedDb, users } from "./helpers";
import { signSession } from "@/server/auth";

const cookieJar = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieJar.value ? { name: "cbm_session", value: cookieJar.value } : undefined) }),
}));

beforeAll(seedDb);

describe("R5 roles", () => {
  it("an analyst cannot approve a decision (R5)", async () => {
    const d = await makeCase({ status: "DECISION_PENDING", amountCents: 90000, decisionType: "ACCEPT_LOSS_WRITE_OFF", proposedBy: "u_ben" });
    const result = await approveDecision(users.ana, d.id, {});
    expect(result).toMatchObject({ ok: false, code: "ROLE_NOT_ALLOWED", httpStatus: 403 });
    expect(await networkCallsFor(d.id)).toHaveLength(0);
    const rows = await historyFor(d.id);
    expect(rows.map((r) => r.action)).toEqual(["action_refused"]);
  });

  it("an analyst approving through the API gets 403, as curl would (R5)", async () => {
    const { POST } = await import("@/app/api/disputes/[id]/[action]/route");
    cookieJar.value = signSession("u_ana");
    const res = await POST(
      new Request("http://localhost/api/disputes/CB-1088/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ id: "CB-1088", action: "approve" }) },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "ROLE_NOT_ALLOWED" } });
    expect(await networkCallsFor("CB-1088")).toHaveLength(1); // only the seeded CHARGEBACK
  });

  it("an auditor cannot file, propose or import (R5)", async () => {
    const fresh = await makeCase({ status: "NEW", evidenceChecked: true });
    expect(await fileChargeback(users.dan, fresh.id)).toMatchObject({ ok: false, code: "ROLE_NOT_ALLOWED" });
    const rep = await makeCase();
    expect(await proposeDecision(users.dan, rep.id, { decisionType: "ACCEPT_LOSS_WRITE_OFF", note: "auditor attempt here" })).toMatchObject({ ok: false, code: "ROLE_NOT_ALLOWED" });
    expect(await importDisputes(users.dan, { csv: "x" })).toMatchObject({ ok: false, code: "ROLE_NOT_ALLOWED" });
  });

  it("policy denies by default and grants only the listed actions (R5, positive control)", () => {
    expect(can(users.ana, "decision:propose")).toBe(true);
    expect(can(users.carla, "decision:approve")).toBe(true);
    expect(can(users.dan, "export")).toBe(true);
    expect(can(users.ana, "decision:approve")).toBe(false);
    expect(can(null, "dispute:read")).toBe(false);
    expect(can({ id: "x", name: "x", role: "superuser" as never }, "dispute:read")).toBe(false);
  });
});
