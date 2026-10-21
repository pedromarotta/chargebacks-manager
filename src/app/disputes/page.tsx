import Link from "next/link";
import { BulkCheckbox, BulkSelectAll, BulkWriteOff } from "@/components/disputes/bulk-write-off";
import { ClientFilter } from "@/components/disputes/client-filter";
import { DueBadge, StatusBadge } from "@/components/status-badge";
import { EmptyState, SignInPrompt } from "@/components/states";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDueIn, formatMoney, REASON_LABELS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getCurrentUser } from "@/server/auth";
import { getQueue, QUEUE_TABS, type QueueTab } from "@/server/disputes/queries";
import { needsApproval } from "@/server/disputes/rules";
import { can } from "@/server/policy";

export const dynamic = "force-dynamic";

const TAB_LABELS: Record<QueueTab, string> = {
  all: "All",
  approval: "Needs my approval",
  representment: "Representment received",
  due72: "Due ≤72h",
  closed: "Closed",
};

function hrefFor(tab: QueueTab, client: string | null) {
  const params = new URLSearchParams();
  if (tab !== "all") params.set("tab", tab);
  if (client) params.set("client", client);
  const qs = params.toString();
  return qs ? `/disputes?${qs}` : "/disputes";
}

export default async function DisputesPage({ searchParams }: { searchParams: Promise<{ tab?: string; client?: string }> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!user) return <SignInPrompt />;

  const tab: QueueTab = (QUEUE_TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as QueueTab) : "all";
  const client = sp.client?.trim() || null;
  const now = new Date();
  const result = await getQueue(user, { tab, client }, now);
  if (!result.ok) return <p className="text-sm">{result.message}</p>;
  const { rows, clients, stats, networkCalls, tabCounts } = result.value;
  const canBulk = can(user, "decision:propose");
  const bulkCandidates = canBulk
    ? rows
        .filter((d) => d.status === "REPRESENTMENT_RECEIVED" && !needsApproval(d.amountCents, d.currency) && new Date(d.dueAt) > now)
        .map((d) => ({ id: d.id, amountCents: d.amountCents, currency: d.currency }))
    : [];

  const strip = [
    { label: "Open cases", value: String(stats.openCases) },
    { label: "At risk of timeout", value: String(stats.atRisk) },
    { label: "Amount at risk", value: formatMoney(stats.amountAtRiskCents, "USD") },
    { label: "Provisional credit outstanding", value: formatMoney(stats.provisionalOutstandingCents, "USD") },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">Disputes</h1>
          <p className="text-sm text-muted-foreground">Sorted by deadline risk: breached first, then due soonest.</p>
        </div>
        <div className="text-sm text-muted-foreground" data-testid="network-calls">
          Network calls: <span className="font-semibold text-zinc-900 tabular-nums">{networkCalls}</span>
        </div>
      </div>

      <section aria-label="Queue summary" className="grid grid-cols-4 gap-4">
        {strip.map((s) => (
          <Card key={s.label} size="sm">
            <CardContent>
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="flex items-center justify-between gap-4">
        <nav aria-label="Queue filters" className="inline-flex h-9 items-center rounded-lg bg-zinc-100 p-1">
          {QUEUE_TABS.map((t) => (
            <Link
              key={t}
              href={hrefFor(t, client)}
              aria-current={t === tab ? "page" : undefined}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-md px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-600",
                t === tab ? "bg-white font-medium shadow-sm" : "text-zinc-600 hover:text-zinc-900",
              )}
            >
              {TAB_LABELS[t]}
              <span className="text-xs text-muted-foreground tabular-nums">{tabCounts[t]}</span>
            </Link>
          ))}
        </nav>
        <ClientFilter clients={clients} value={client} />
      </div>

      <BulkWriteOff candidates={bulkCandidates}>
      <div className="rounded-lg border border-zinc-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              {canBulk ? (
                <TableHead className="w-8">
                  <BulkSelectAll />
                </TableHead>
              ) : null}
              <TableHead>Case</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Merchant</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Due in</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canBulk ? 8 : 7}>
                  <EmptyState title="No disputes match this filter." hint="Try another tab or client, or import today's file." />
                </TableCell>
              </TableRow>
            ) : (
              rows.map((d) => (
                <TableRow key={d.id} className="h-11">
                  {canBulk ? (
                    <TableCell className="w-8">
                      <BulkCheckbox id={d.id} />
                    </TableCell>
                  ) : null}
                  <TableCell className="font-medium">
                    <Link href={`/disputes/${d.id}`} className="text-indigo-700 hover:underline focus-visible:underline">
                      {d.id}
                    </Link>
                  </TableCell>
                  <TableCell>{d.client}</TableCell>
                  <TableCell>{d.merchant}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(d.amountCents, d.currency)}</TableCell>
                  <TableCell>{REASON_LABELS[d.reasonCode] ?? d.reasonCode}</TableCell>
                  <TableCell>
                    <DueBadge risk={d.risk} dueIn={formatDueIn(d.dueAt, now)} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={d.status} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      </BulkWriteOff>
    </div>
  );
}
