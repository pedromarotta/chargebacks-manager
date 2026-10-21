import { describe, expect, it } from "vitest";
import { computeMetrics, getMetrics, type MetricsInput } from "@/server/disputes/metrics";
import { users } from "./helpers";

const now = new Date("2026-10-21T12:00:00Z");
const hours = (h: number) => new Date(now.getTime() + h * 3_600_000);
const row = (over: Partial<MetricsInput>): MetricsInput => ({
  status: "NEW",
  amountCents: 10000,
  provisionalCreditCents: 10000,
  dueAt: hours(500),
  decisionType: null,
  decidedBy: null,
  recommendation: null,
  ...over,
});

describe("metrics (backlog 1)", () => {
  it("buckets open disputes by days left and sums amounts at risk and provisional credit", () => {
    const m = computeMetrics(
      [
        row({ dueAt: hours(-1), amountCents: 100 }),
        row({ dueAt: hours(10), amountCents: 200, provisionalCreditCents: 0 }),
        row({ dueAt: hours(48), amountCents: 300 }),
        row({ dueAt: hours(100) }),
        row({ dueAt: hours(400) }),
        row({ status: "CLOSED_WON", dueAt: hours(-100) }),
      ],
      now,
    );
    expect(m.byDaysLeft.map((b) => b.count)).toEqual([1, 1, 1, 1, 0, 1]);
    expect(m.open).toEqual({ count: 5, amountCents: 20600 });
    expect(m.atRisk).toEqual({ count: 3, amountCents: 600 });
    expect(m.provisionalOutstandingCents).toBe(40000);
  });

  it("win and loss rate on closed cases; written off and expired count as losses", () => {
    const m = computeMetrics(
      [row({ status: "CLOSED_WON" }), row({ status: "CLOSED_LOST" }), row({ status: "WRITTEN_OFF" }), row({ status: "EXPIRED" }), row({ status: "NEW" })],
      now,
    );
    expect(m.closed).toEqual({ total: 4, won: 1, lost: 1, writtenOff: 1, expired: 1, winRate: 0.25 });
    expect(computeMetrics([row({})], now).closed.winRate).toBeNull();
  });

  it("counts how often the decided action matched the recommendation", () => {
    const m = computeMetrics(
      [
        row({ status: "PRE_ARB_FILED", decisionType: "ESCALATE_PRE_ARB", decidedBy: "u_eve", recommendation: "FIGHT" }),
        row({ status: "WRITTEN_OFF", decisionType: "ACCEPT_LOSS_WRITE_OFF", decidedBy: "u_ana", recommendation: "FIGHT" }),
        row({ status: "CLOSED_LOST", decisionType: "ACCEPT_LOSS_REVERSE_CREDIT", decidedBy: "u_carla", recommendation: "ACCEPT" }),
        // Pending (not decided) and no-P(win) decisions are left out.
        row({ status: "DECISION_PENDING", decisionType: "ESCALATE_PRE_ARB", recommendation: "FIGHT" }),
        row({ status: "WRITTEN_OFF", decisionType: "ACCEPT_LOSS_WRITE_OFF", decidedBy: "u_ana" }),
      ],
      now,
    );
    expect(m.recommendation).toEqual({ decided: 3, matched: 2, rate: 2 / 3 });
  });

  it("auditors can read metrics; signed-out users cannot", async () => {
    expect((await getMetrics(users.dan, now)).ok).toBe(true);
    expect(await getMetrics(null, now)).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });
});
