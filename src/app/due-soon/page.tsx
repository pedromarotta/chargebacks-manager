import Link from "next/link";
import { DueBadge, StatusBadge } from "@/components/status-badge";
import { EmptyState, SignInPrompt } from "@/components/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatDueIn, formatMoney } from "@/lib/format";
import { getCurrentUser } from "@/server/auth";
import { getDueSoonDigest } from "@/server/disputes/digest";

export const dynamic = "force-dynamic";

export default async function DueSoonPage() {
  const user = await getCurrentUser();
  if (!user) return <SignInPrompt />;
  const now = new Date();
  const result = await getDueSoonDigest(user, now);
  if (!result.ok) return <p className="text-sm">{result.message}</p>;
  const digest = result.value;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Due soon</h1>
          <p className="text-sm text-muted-foreground">
            Open cases due within the next 2 days, as of {formatDateTime(now.toISOString())}. In-app only. No email is sent.
          </p>
        </div>
        <div className="text-sm text-muted-foreground" data-testid="digest-summary">
          <span className="font-medium text-zinc-900">{digest.total}</span> cases ·{" "}
          <span className="font-medium text-zinc-900">{formatMoney(digest.amountCents, "USD")}</span> ·{" "}
          <span className="font-medium text-zinc-900">{digest.needsYou}</span> need you
        </div>
      </div>
      {digest.total === 0 ? (
        <Card>
          <CardContent>
            <EmptyState title="Nothing is due in the next 2 days." hint="New cases show up here as their deadlines get close." />
          </CardContent>
        </Card>
      ) : (
        digest.groups
          .filter((g) => g.items.length > 0)
          .map((g) => (
            <Card key={g.key} aria-labelledby={`digest-${g.key}`}>
              <CardHeader>
                <CardTitle id={`digest-${g.key}`} className="text-base">
                  {g.label} <span className="font-normal text-muted-foreground">· {g.items.length}</span>
                </CardTitle>
                {g.hint ? <p className="text-sm text-muted-foreground">{g.hint}</p> : null}
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Case</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Due in</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Next step</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.items.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>
                          <Link href={`/disputes/${d.id}`} className="font-medium text-indigo-700 hover:underline">
                            {d.id}
                          </Link>
                        </TableCell>
                        <TableCell>{d.client}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(d.amountCents, d.currency)}</TableCell>
                        <TableCell>
                          <DueBadge risk={d.risk} dueIn={formatDueIn(d.dueAt, now)} />
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={d.status} />
                        </TableCell>
                        <TableCell className="text-sm">
                          {d.nextStep}
                          {d.needsYou ? (
                            <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">Needs you</span>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))
      )}
    </div>
  );
}
