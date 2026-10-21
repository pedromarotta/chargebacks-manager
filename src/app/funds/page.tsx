import Link from "next/link";
import { FundsAlertPill } from "@/components/disputes/funds-panel";
import { Pill } from "@/components/status-badge";
import { EmptyState, SignInPrompt } from "@/components/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatHours, formatMoney } from "@/lib/format";
import { FUNDS_MOVE_LABELS, FUNDS_STATUS_LABELS, PARKED_BUCKETS, type FundsMove, type FundsStatus } from "@/lib/funds";
import { getCurrentUser } from "@/server/auth";
import { getFundsBoard } from "@/server/disputes/funds-board";

export const dynamic = "force-dynamic";

export default async function FundsPage() {
  const user = await getCurrentUser();
  if (!user) return <SignInPrompt />;
  const result = await getFundsBoard(user);
  if (!result.ok) return <p className="text-sm">{result.message}</p>;
  const b = result.value;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Funds tracking</h1>
        <p className="text-sm text-muted-foreground">
          Won cases where the cardholder had no provisional credit, so the money reaches them only after the win. Funds are parked from receipt until they&apos;re credited to the cardholder. Limits by jurisdiction are illustrative.
        </p>
      </div>
      <div className="grid grid-cols-5 gap-3" aria-label="Parked funds by age">
        {PARKED_BUCKETS.map((k) => (
          <Card key={k.key} className={k.key === "over_limit" && b.buckets[k.key] > 0 ? "border-red-300" : undefined}>
            <CardContent className="py-3">
              <div className="text-xs text-muted-foreground">{k.label}</div>
              <div className={`text-2xl font-semibold tabular-nums ${k.key === "over_limit" && b.buckets[k.key] > 0 ? "text-red-700" : ""}`}>{b.buckets[k.key]}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-sm text-muted-foreground" data-testid="funds-summary">
        <span className="font-medium text-zinc-900">{formatMoney(b.parkedCents, "USD")}</span> parked ·{" "}
        <span className="font-medium text-zinc-900">{b.overLimit}</span> over the limit ·{" "}
        <span className="font-medium text-zinc-900">{b.alerts}</span> near the limit ·{" "}
        <span className="font-medium text-zinc-900">{b.pendingApproval}</span> waiting for approval
      </p>
      <Card>
        <CardHeader><CardTitle className="text-base">Won cases</CardTitle></CardHeader>
        <CardContent>
          {b.rows.length === 0 ? (
            <EmptyState title="No funds to track." hint="Won cases without a provisional credit show up here." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Case</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Jurisdiction</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Funds</TableHead>
                  <TableHead>Parked</TableHead>
                  <TableHead>Alert</TableHead>
                  <TableHead>Waiting for approval</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {b.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><Link href={`/disputes/${r.id}`} className="font-medium text-indigo-700 hover:underline">{r.id}</Link></TableCell>
                    <TableCell>{r.client}</TableCell>
                    <TableCell>{r.jurisdiction}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.amountCents, r.currency)}</TableCell>
                    <TableCell><Pill tone="grey">{FUNDS_STATUS_LABELS[r.fundsStatus as FundsStatus]}</Pill></TableCell>
                    <TableCell className="tabular-nums">{r.funds.parkedHours === null ? "—" : `${formatHours(r.funds.parkedHours)}${r.funds.parked ? "" : " (settled)"}`}</TableCell>
                    <TableCell><FundsAlertPill info={r.funds} /></TableCell>
                    <TableCell>{r.fundsPendingMove ? FUNDS_MOVE_LABELS[r.fundsPendingMove as FundsMove] : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
