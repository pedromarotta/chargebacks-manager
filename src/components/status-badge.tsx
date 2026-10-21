import { AlarmClock, CheckCircle2, CircleDashed, Clock, FileText, Hourglass, Send, ShieldAlert, XCircle } from "lucide-react";
import type { ComponentType } from "react";
import { cn } from "@/lib/utils";
import { STATUS_LABELS } from "@/lib/format";

export const TONE = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/25",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  grey: "bg-zinc-100 text-zinc-700 ring-zinc-500/20",
} as const;
export type Tone = keyof typeof TONE;

const STATUS_STYLE: Record<string, { tone: Tone; icon: ComponentType<{ className?: string }> }> = {
  NEW: { tone: "grey", icon: CircleDashed },
  CHARGEBACK_FILED: { tone: "indigo", icon: Send },
  REPRESENTMENT_RECEIVED: { tone: "amber", icon: FileText },
  DECISION_PENDING: { tone: "amber", icon: Hourglass },
  WRITTEN_OFF: { tone: "grey", icon: CheckCircle2 },
  CLOSED_LOST: { tone: "red", icon: XCircle },
  PRE_ARB_FILED: { tone: "indigo", icon: Send },
  CLOSED_WON: { tone: "green", icon: CheckCircle2 },
  EXPIRED: { tone: "red", icon: XCircle },
};

export function Pill({ tone, icon: Icon, children, className }: { tone: Tone; icon?: ComponentType<{ className?: string }>; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium whitespace-nowrap ring-1 ring-inset", TONE[tone], className)}>
      {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLE[status] ?? { tone: "grey" as Tone, icon: CircleDashed };
  return (
    <Pill tone={style.tone} icon={style.icon}>
      {STATUS_LABELS[status] ?? status}
    </Pill>
  );
}

const RISK_STYLE: Record<string, { tone: Tone; icon: ComponentType<{ className?: string }>; label: string }> = {
  breached: { tone: "red", icon: ShieldAlert, label: "Breached" },
  imminent: { tone: "amber", icon: AlarmClock, label: "Due ≤24h" },
  near: { tone: "amber", icon: Clock, label: "Due ≤72h" },
  ok: { tone: "grey", icon: Clock, label: "On track" },
};

/** Due-in badge: the time left is always shown as text, never colour alone. */
export function DueBadge({ risk, dueIn }: { risk: string | null; dueIn: string }) {
  if (!risk) return <span className="text-xs text-muted-foreground">—</span>;
  const style = RISK_STYLE[risk] ?? RISK_STYLE.ok;
  return (
    <Pill tone={style.tone} icon={style.icon}>
      <span className="sr-only">{style.label}: </span>
      <span className="tabular-nums">{dueIn}</span>
    </Pill>
  );
}
