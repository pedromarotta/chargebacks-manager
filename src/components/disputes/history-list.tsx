import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/states";
import { formatDateTime, historyChanges, historyTitle, initials, isRefusal, ROLE_LABELS } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HistoryView } from "@/server/disputes/view";

interface Props {
  rows: HistoryView[];
  names: Record<string, string>;
  currency?: string;
  compact?: boolean;
}

export function HistoryList({ rows, names, currency = "USD", compact = false }: Props) {
  if (rows.length === 0) return <EmptyState title="No history yet." />;
  return (
    <ol className="flex flex-col gap-2">
      {rows.map((h) => {
        const refused = isRefusal(h.action);
        const who = names[h.actorId] ?? h.actorId;
        return (
          <li
            key={h.id}
            className={cn("flex gap-3 rounded-md p-2 text-sm", refused ? "border border-red-200 bg-red-50/70" : "border border-transparent")}
          >
            <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-semibold text-zinc-700">
              {initials(who)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2">
                {refused ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700">
                    <ShieldAlert className="size-3.5" aria-hidden />
                    Refused
                  </span>
                ) : null}
                <span className="font-medium">{historyTitle(h)}</span>
                {!compact && h.disputeId ? (
                  <Link href={`/disputes/${h.disputeId}`} className="text-indigo-700 hover:underline">
                    {h.disputeId}
                  </Link>
                ) : null}
              </div>
              <div className="text-xs text-muted-foreground">
                {who} · {ROLE_LABELS[h.actorRole] ?? h.actorRole} · <time dateTime={h.at}>{formatDateTime(h.at)}</time>
              </div>
              {historyChanges(h, currency).map((c) => (
                <div key={c} className="text-xs">
                  {c}
                </div>
              ))}
              {h.note ? <div className="mt-1 text-xs italic text-zinc-700">“{h.note}”</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
