"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Pill } from "@/components/status-badge";
import { InlineAlert } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { postJson } from "@/lib/api-client";
import { formatHours } from "@/lib/format";
import { FUNDS_MOVE_FROM, FUNDS_MOVE_LABELS, FUNDS_MOVES, FUNDS_STATUS_LABELS, type FundsInfo, type FundsMove, type FundsStatus } from "@/lib/funds";
import type { DisputeView } from "@/server/disputes/view";

const PATH: FundsStatus[] = ["FUNDS_NOT_YET_RECEIVED", "FUNDS_RECEIVED_FROM_ACQUIRER", "FUNDS_CREDITED_TO_PROGRAM", "FUNDS_CREDITED_TO_CARDHOLDER"];

export function FundsAlertPill({ info }: { info: FundsInfo }) {
  if (info.alert === "over_limit") return <Pill tone="red">Over the {info.limitHours}h limit</Pill>;
  if (info.alert === "alert") return <Pill tone="amber">Alert: limit {info.limitHours}h</Pill>;
  if (info.alert === "ok") return <Pill tone="green">Within limit</Pill>;
  return null;
}

/** Backlog 9: funds after a won case. Crediting the cardholder or reversing always needs a different lead (R4). */
export function FundsPanel({ dispute: d, info, userId, names, perms }: {
  dispute: DisputeView;
  info: FundsInfo;
  userId: string;
  names: Record<string, string>;
  perms: { move: boolean; approve: boolean };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [move, setMove] = useState<FundsMove | null>(null);
  const [note, setNote] = useState("");

  async function act(action: string, body: unknown, success: string) {
    setBusy(action);
    const result = await postJson(`/api/disputes/${encodeURIComponent(d.id)}/${action}`, body);
    setBusy(null);
    if (result.ok) {
      setError(null);
      setNote("");
      setMove(null);
      toast.success(success);
    } else {
      setError(result.message);
      toast.error(result.message);
    }
    router.refresh();
  }

  if (!d.fundsStatus) {
    return (
      <Card>
        <CardHeader><CardTitle>Funds</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">The cardholder had a provisional credit, so the win made it final. There are no funds to track.</CardContent>
      </Card>
    );
  }
  const status = d.fundsStatus as FundsStatus;
  const path = status === "FUNDS_REVERSED" ? [...PATH.slice(0, 3), "FUNDS_REVERSED" as const] : PATH;
  const idx = path.indexOf(status);
  const movesAllowed = FUNDS_MOVES.filter((m) => FUNDS_MOVE_FROM[m].includes(status));
  const pending = d.fundsPendingMove as FundsMove | null;

  return (
    <Card aria-labelledby="funds-title">
      <CardHeader>
        <CardTitle id="funds-title">Funds</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <ol className="flex flex-wrap items-center gap-2" aria-label="Funds status">
          {path.map((s, i) => (
            <li key={s} className="flex items-center gap-2" aria-current={i === idx ? "step" : undefined}>
              <Pill tone={i < idx ? "indigo" : i === idx ? (s === "FUNDS_REVERSED" ? "red" : "green") : "grey"}>{FUNDS_STATUS_LABELS[s]}</Pill>
              {i < path.length - 1 ? <span className="text-zinc-300" aria-hidden>→</span> : null}
            </li>
          ))}
        </ol>
        {info.parkedHours !== null ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="funds-parked">
            <span>
              {info.parked ? "Parked for " : "Was parked for "}
              <span className="font-medium tabular-nums">{formatHours(info.parkedHours)}</span>
              {" · "}
              {d.jurisdiction} limit {info.limitHours}h, alert at {info.alertAtHours}h
            </span>
            <FundsAlertPill info={info} />
          </div>
        ) : (
          <p className="text-muted-foreground">Waiting for the acquirer to send the funds.</p>
        )}
        {error ? <InlineAlert message={error} /> : null}

        {pending ? (
          <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
            <div>
              <span className="font-medium">{FUNDS_MOVE_LABELS[pending]}</span> · proposed by {names[d.fundsProposedBy ?? ""] ?? d.fundsProposedBy}. Needs a different lead&apos;s approval.
            </div>
            {d.fundsProposalNote ? <p className="text-muted-foreground">&ldquo;{d.fundsProposalNote}&rdquo;</p> : null}
            {perms.approve || perms.move ? (
              <>
                <Textarea aria-label="Comment or reason" placeholder="Comment (optional to approve, required to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy !== null} onClick={() => void act("funds-approve", { comment: note || undefined }, "Funds move approved.")}>Approve</Button>
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void act("funds-reject", { note }, "Funds move rejected.")}>Reject</Button>
                </div>
                {d.fundsProposedBy === userId ? <p className="text-xs text-muted-foreground">You proposed this move, so a different lead has to decide it.</p> : null}
              </>
            ) : null}
          </div>
        ) : perms.move ? (
          <div className="flex flex-col gap-3">
            {status === "FUNDS_RECEIVED_FROM_ACQUIRER" ? (
              <Button size="sm" variant="outline" className="self-start" disabled={busy !== null} onClick={() => void act("funds-program", {}, "Funds credited to the program.")}>
                Mark credited to program
              </Button>
            ) : null}
            {movesAllowed.length > 0 ? (
              <form
                className="flex flex-col gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!move) return setError("Choose a funds move first.");
                  void act("funds-propose", { move, note }, "Funds move proposed. It needs a lead's approval.");
                }}
              >
                <fieldset className="flex flex-wrap gap-4">
                  <legend className="mb-1 font-medium">Propose a funds move</legend>
                  {movesAllowed.map((m) => (
                    <label key={m} className="flex items-center gap-2">
                      <input type="radio" name="funds-move" value={m} checked={move === m} onChange={() => setMove(m)} />
                      {FUNDS_MOVE_LABELS[m]}
                    </label>
                  ))}
                </fieldset>
                <Textarea aria-label="Reason for the funds move" placeholder="Reason (at least 10 characters)" value={note} onChange={(e) => setNote(e.target.value)} />
                <Button size="sm" type="submit" className="self-start" disabled={busy !== null}>Propose</Button>
              </form>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
