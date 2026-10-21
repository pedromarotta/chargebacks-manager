import { SignInPrompt } from "@/components/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getCurrentUser } from "@/server/auth";
import { getMetrics } from "@/server/disputes/metrics";

export const dynamic = "force-dynamic";

const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);

export default async function MetricsPage() {
  const user = await getCurrentUser();
  if (!user) return <SignInPrompt />;
  const result = await getMetrics(user);
  if (!result.ok) return <p className="text-sm">{result.message}</p>;
  const m = result.value;
  const usd = (c: number) => formatMoney(c, "USD");

  const strip = [
    { label: "Open disputes", value: String(m.open.count), sub: `${usd(m.open.amountCents)} disputed` },
    { label: "At risk of timeout", value: String(m.atRisk.count), sub: `${usd(m.atRisk.amountCents)} at risk` },
    { label: "Provisional credit outstanding", value: usd(m.provisionalOutstandingCents), sub: "on open cases" },
    { label: "Win rate", value: pct(m.closed.winRate), sub: `${m.closed.won} of ${m.closed.total} closed` },
    { label: "Decision matched recommendation", value: pct(m.recommendation.rate), sub: `${m.recommendation.matched} of ${m.recommendation.decided} decided with P(win)` },
  ];
  const maxCount = Math.max(1, ...m.byDaysLeft.map((b) => b.count));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Metrics</h1>
        <p className="text-sm text-muted-foreground">Live from the case data. Amounts in USD.</p>
      </div>
      <div className="grid grid-cols-5 gap-4">
        {strip.map((s) => (
          <Card key={s.label} size="sm">
            <CardContent>
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="text-xl font-semibold tabular-nums">{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-[3fr_2fr] gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Open disputes by days left</CardTitle>
          </CardHeader>
          <CardContent>
            <Table aria-label="Open disputes by days left">
              <TableHeader>
                <TableRow>
                  <TableHead>Days left</TableHead>
                  <TableHead className="w-1/2" />
                  <TableHead className="text-right">Cases</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {m.byDaysLeft.map((b, i) => (
                  <TableRow key={b.key} className="h-11">
                    <TableCell>{b.label}</TableCell>
                    <TableCell>
                      <div
                        className={cn("h-2 rounded-full", i === 0 ? "bg-red-500" : i <= 2 ? "bg-amber-500" : "bg-indigo-500")}
                        style={{ width: `${(b.count / maxCount) * 100}%` }}
                        aria-hidden
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{b.count}</TableCell>
                    <TableCell className="text-right tabular-nums">{usd(b.amountCents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Closed cases</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm tabular-nums">
              <dt>Won</dt>
              <dd className="text-right text-emerald-700">{m.closed.won}</dd>
              <dt>Lost</dt>
              <dd className="text-right text-red-700">{m.closed.lost}</dd>
              <dt>Written off (loss accepted)</dt>
              <dd className="text-right">{m.closed.writtenOff}</dd>
              <dt>Expired (deadline missed)</dt>
              <dd className="text-right">{m.closed.expired}</dd>
              <dt className="border-t pt-2 font-medium">Win rate</dt>
              <dd className="border-t pt-2 text-right font-medium">{pct(m.closed.winRate)}</dd>
              <dt className="font-medium">Loss rate</dt>
              <dd className="text-right font-medium">{m.closed.winRate === null ? "—" : pct(1 - m.closed.winRate)}</dd>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">Written off and expired cases count as losses.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
