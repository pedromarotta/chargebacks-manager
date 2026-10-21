import { Check, Circle, Minus, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import type { TimelineStep } from "@/lib/timeline";
import { cn } from "@/lib/utils";

const STATE_LABEL = { done: "done", current: "current step", failed: "failed", skipped: "doesn't apply", upcoming: "not started" } as const;

/** The 8 lifecycle steps (BUSINESS_RULES §1), with dates from history and the rejected-filing path. */
export function Lifecycle({ steps }: { steps: TimelineStep[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Lifecycle</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col" aria-label="Lifecycle steps">
          {steps.map((s, i) => (
            <li key={s.title} className="relative flex gap-3 pb-4 last:pb-0" aria-current={s.state === "current" ? "step" : undefined} data-state={s.state}>
              {i < steps.length - 1 ? <span className="absolute top-6 left-[9px] h-[calc(100%-20px)] w-px bg-zinc-200" aria-hidden /> : null}
              <span
                className={cn(
                  "relative z-10 mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border bg-white",
                  s.state === "done" && "border-indigo-600 bg-indigo-600 text-white",
                  s.state === "current" && "border-indigo-600 text-indigo-700",
                  s.state === "failed" && "border-red-600 bg-red-600 text-white",
                  (s.state === "skipped" || s.state === "upcoming") && "border-zinc-300 text-zinc-300",
                )}
              >
                {s.state === "done" ? <Check className="size-3" aria-hidden /> : s.state === "failed" ? <X className="size-3" aria-hidden /> : s.state === "skipped" ? <Minus className="size-3" aria-hidden /> : <Circle className="size-2 fill-current" aria-hidden />}
              </span>
              <div className="min-w-0 text-sm">
                <div className={cn(s.state === "current" || s.state === "failed" ? "font-medium" : "", s.state === "skipped" && "text-muted-foreground line-through decoration-zinc-300", s.state === "upcoming" && "text-muted-foreground", s.state === "failed" && "text-red-700")}>
                  {s.n ? `${s.n}. ` : ""}
                  {s.title}
                  <span className="sr-only"> ({STATE_LABEL[s.state]})</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {s.owner}
                  {s.at ? ` · ${formatDateTime(s.at)}` : ""}
                </div>
                {s.detail ? <div className={cn("text-xs", s.state === "failed" ? "text-red-700" : "text-muted-foreground")}>{s.detail}</div> : null}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
