import { Check, Circle, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { STATUS_LABELS } from "@/lib/format";
import { cn } from "@/lib/utils";

function pathFor(status: string, decisionType: string | null): string[] {
  const base = ["NEW", "CHARGEBACK_FILED", "REPRESENTMENT_RECEIVED", "DECISION_PENDING"];
  if (status === "WRITTEN_OFF" || status === "CLOSED_LOST") {
    return decisionType === "ESCALATE_PRE_ARB" ? [...base, "PRE_ARB_FILED", status] : [...base, status];
  }
  if (status === "CLOSED_WON") return decisionType ? [...base, "PRE_ARB_FILED", status] : ["NEW", "CHARGEBACK_FILED", status];
  if (status === "PRE_ARB_FILED") return [...base, "PRE_ARB_FILED", "CLOSED_WON"];
  if (status === "EXPIRED") return ["NEW", "EXPIRED"];
  return [...base, "Outcome"];
}

/** Workflow status path, with the current step highlighted. */
export function Lifecycle({ status, decisionType }: { status: string; decisionType: string | null }) {
  const steps = pathFor(status, decisionType);
  const currentIndex = status === "EXPIRED" ? steps.length - 1 : steps.indexOf(status);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Lifecycle</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-2 text-sm">
          {steps.map((s, i) => {
            const done = i < currentIndex;
            const current = i === currentIndex;
            const failed = current && (s === "EXPIRED" || s === "CLOSED_LOST");
            return (
              <li key={s} className="flex items-center gap-2" aria-current={current ? "step" : undefined}>
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full border",
                    done && "border-indigo-600 bg-indigo-600 text-white",
                    current && !failed && "border-indigo-600 text-indigo-700",
                    failed && "border-red-600 bg-red-600 text-white",
                    !done && !current && "border-zinc-300 text-zinc-300",
                  )}
                >
                  {failed ? <X className="size-3" aria-hidden /> : done ? <Check className="size-3" aria-hidden /> : <Circle className="size-2 fill-current" aria-hidden />}
                </span>
                <span className={cn(current ? "font-medium" : done ? "" : "text-muted-foreground")}>
                  {STATUS_LABELS[s] ?? s}
                  {current ? <span className="sr-only"> (current)</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
