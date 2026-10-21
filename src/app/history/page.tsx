import Link from "next/link";
import { HistoryList } from "@/components/disputes/history-list";
import { SignInPrompt } from "@/components/states";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getCurrentUser } from "@/server/auth";
import { HISTORY_FILTERS, listHistory, listUsers, type HistoryFilter } from "@/server/disputes/queries";

export const dynamic = "force-dynamic";

const LABELS: Record<HistoryFilter, string> = { all: "All", refusals: "Refusals", decisions: "Decisions", imports: "Imports" };

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ kind?: string; actor?: string; case?: string }> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!user) return <SignInPrompt />;
  const kind: HistoryFilter = (HISTORY_FILTERS as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as HistoryFilter) : "all";
  const actorId = sp.actor?.trim() || null;
  const disputeId = sp.case?.trim() || null;
  const [result, users] = await Promise.all([listHistory(user, { kind, actorId, disputeId }), listUsers()]);
  if (!result.ok) return <p className="text-sm">{result.message}</p>;
  const names: Record<string, string> = Object.fromEntries(users.map((u) => [u.id, u.name]));
  names.network = "Card network (simulated)";

  const hrefFor = (k: HistoryFilter) => {
    const p = new URLSearchParams();
    if (k !== "all") p.set("kind", k);
    if (actorId) p.set("actor", actorId);
    if (disputeId) p.set("case", disputeId);
    const qs = p.toString();
    return qs ? `/history?${qs}` : "/history";
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">History</h1>
        <p className="text-sm text-muted-foreground">Every change and every refused attempt, newest first. Append-only.</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <nav aria-label="History filters" className="inline-flex h-9 items-center rounded-lg bg-zinc-100 p-1">
          {HISTORY_FILTERS.map((k) => (
            <Link
              key={k}
              href={hrefFor(k)}
              aria-current={k === kind ? "page" : undefined}
              className={cn(
                "flex h-7 items-center rounded-md px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-600",
                k === kind ? "bg-white font-medium shadow-sm" : "text-zinc-600 hover:text-zinc-900",
              )}
            >
              {LABELS[k]}
            </Link>
          ))}
        </nav>
        <form method="get" className="flex items-center gap-2 text-sm">
          {kind !== "all" ? <input type="hidden" name="kind" value={kind} /> : null}
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">User</span>
            <select name="actor" defaultValue={actorId ?? ""} className="h-8 rounded-md border border-zinc-200 bg-white px-2">
              <option value="">Anyone</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
              <option value="network">Card network (simulated)</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Case</span>
            <input name="case" defaultValue={disputeId ?? ""} placeholder="CB-1042" className="h-8 w-28 rounded-md border border-zinc-200 bg-white px-2" />
          </label>
          <Button type="submit" variant="outline">
            Apply
          </Button>
        </form>
      </div>
      <div className="rounded-lg border border-zinc-200 bg-white p-2">
        <HistoryList rows={result.value} names={names} />
      </div>
    </div>
  );
}
