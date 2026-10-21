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
import { assessFightOrAccept, followsRecommendation } from "@/lib/fight-or-accept";
import { NETWORK } from "@/lib/network-config";
import { DECISION_LABELS, RECOMMENDATION_LABELS, STATUS_LABELS, formatDateTime, formatMoney, formatSignedMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DisputeView } from "@/server/disputes/view";
import { ShieldCheck } from "lucide-react";

interface Props {
  dispute: DisputeView;
  names: Record<string, string>;
  perms: { file: boolean; propose: boolean; decide: boolean };
  missingEvidence: string[];
  needsApproval: boolean;
  preArbFee: string;
}

type Choice = "ACCEPT_LOSS_WRITE_OFF" | "ACCEPT_LOSS_REVERSE_CREDIT" | "ESCALATE_PRE_ARB";

export function DecisionPanel({ dispute: d, names, perms, missingEvidence, needsApproval, preArbFee }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [note, setNote] = useState("");
  const [pWin, setPWin] = useState("");

  async function act(action: string, body: unknown, success: string) {
    setBusy(action);
    const result = await postJson(`/api/disputes/${encodeURIComponent(d.id)}/${action}`, body);
    setBusy(null);
    if (result.ok) {
      setError(null);
      toast.success(success);
    } else {
      setError(result.message);
      toast.error(result.message);
    }
    router.refresh();
  }

  const name = (id: string | null) => (id ? names[id] ?? id : "—");
  let body: React.ReactNode;

  if (d.status === "NEW") {
    body = (
      <div className="flex flex-col gap-3 text-sm">
        <p>Check the required evidence, then file the chargeback with the network.</p>
        {missingEvidence.length > 0 ? (
          <p className="text-xs text-amber-800">Still unchecked: {missingEvidence.join("; ")}</p>
        ) : null}
        {perms.file ? (
          <div>
            <Button onClick={() => act("file", {}, "Chargeback filed with the network.")} disabled={busy !== null}>
              {busy === "file" ? "Filing…" : "File chargeback"}
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground">Your role can view this case but not file it.</p>
        )}
      </div>
    );
  } else if (d.status === "REPRESENTMENT_RECEIVED") {
    const options: { value: Choice; title: string; hint: string }[] = [
      { value: "ACCEPT_LOSS_WRITE_OFF", title: DECISION_LABELS.ACCEPT_LOSS_WRITE_OFF, hint: "We absorb the loss; the cardholder keeps the provisional credit." },
      { value: "ACCEPT_LOSS_REVERSE_CREDIT", title: DECISION_LABELS.ACCEPT_LOSS_REVERSE_CREDIT, hint: "The cardholder's provisional credit is reversed to $0." },
      { value: "ESCALATE_PRE_ARB", title: DECISION_LABELS.ESCALATE_PRE_ARB, hint: `Fight it. Network fee ${preArbFee}.` },
    ];
    body = perms.propose ? (
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!choice) {
            setError("Choose a decision first.");
            return;
          }
          const pWinPct = pWin.trim() === "" ? undefined : Number(pWin);
          void act("propose", { decisionType: choice, note, pWinPct }, needsApproval ? "Decision proposed. It now needs a lead's approval." : "Decision executed.");
        }}
      >
        <FightOrAcceptHelper amountCents={d.amountCents} currency={d.currency} pWin={pWin} onPWin={setPWin} />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 flex items-center gap-2 text-sm font-medium">
            Decision
            {needsApproval ? (
              <Pill tone="amber" icon={ShieldCheck}>
                Needs lead approval
              </Pill>
            ) : null}
          </legend>
          {options.map((o) => (
            <label
              key={o.value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-600",
                choice === o.value ? "border-indigo-600 bg-indigo-50/60" : "border-zinc-200 hover:bg-zinc-50",
              )}
            >
              <input type="radio" name="decision" value={o.value} checked={choice === o.value} onChange={() => setChoice(o.value)} className="mt-0.5 accent-indigo-600" />
              <span>
                <span className="block font-medium">{o.title}</span>
                <span className="block text-xs text-muted-foreground">{o.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Note</span>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this decision? At least 10 characters." rows={3} />
        </label>
        <div>
          <Button type="submit" disabled={busy !== null}>
            {busy === "propose" ? "Proposing…" : "Propose decision"}
          </Button>
        </div>
      </form>
    ) : (
      <p className="text-sm text-muted-foreground">The merchant responded. An analyst or lead will propose a decision.</p>
    );
  } else if (d.status === "DECISION_PENDING") {
    body = (
      <div className="flex flex-col gap-3 text-sm">
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <div className="mb-1 flex items-center gap-2 font-medium">
            <Pill tone="amber">Awaiting approval</Pill>
            {d.decisionType ? DECISION_LABELS[d.decisionType] : null}
          </div>
          <p className="text-xs text-muted-foreground">Proposed by {name(d.proposedBy)}</p>
          {d.proposalNote ? <p className="mt-2 whitespace-pre-wrap">“{d.proposalNote}”</p> : null}
          <SavedRecommendation dispute={d} />
        </div>
        {perms.decide ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="font-medium">Note</span>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional to approve; required to reject (at least 10 characters)." rows={3} />
            </label>
            <div className="flex gap-2">
              <Button onClick={() => act("approve", note.trim() ? { comment: note } : {}, "Decision approved and executed.")} disabled={busy !== null}>
                {busy === "approve" ? "Approving…" : "Approve"}
              </Button>
              <Button variant="outline" onClick={() => act("reject", { note }, "Decision rejected. The case is back for a new proposal.")} disabled={busy !== null}>
                {busy === "reject" ? "Rejecting…" : "Reject"}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    );
  } else if (d.status === "CHARGEBACK_FILED") {
    body = <p className="text-sm text-muted-foreground">Filed with the network. Waiting for the merchant&apos;s response.</p>;
  } else if (d.status === "PRE_ARB_FILED") {
    body = <p className="text-sm text-muted-foreground">Pre-arbitration filed. Waiting for the network&apos;s ruling.</p>;
  } else {
    body = (
      <div className="flex flex-col gap-1 text-sm">
        <p className="font-medium">{STATUS_LABELS[d.status] ?? d.status}</p>
        {d.status === "EXPIRED" ? (
          <p className="text-muted-foreground">The network deadline ({formatDateTime(d.dueAt)}) passed before the next step, so the case expired.</p>
        ) : null}
        {d.decisionType ? (
          <p className="text-muted-foreground">
            {DECISION_LABELS[d.decisionType]} · proposed by {name(d.proposedBy)}
            {d.decidedBy ? ` · decided by ${name(d.decidedBy)}` : ""}
          </p>
        ) : null}
        <SavedRecommendation dispute={d} />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Decision</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? <InlineAlert message={error} /> : null}
        {body}
      </CardContent>
    </Card>
  );
}

function FightOrAcceptHelper({ amountCents, currency, pWin, onPWin }: { amountCents: number; currency: string; pWin: string; onPWin: (v: string) => void }) {
  const pct = pWin.trim() === "" ? null : Number(pWin);
  const a = pct === null ? null : assessFightOrAccept(amountCents, currency, pct);
  const money = (c: number) => formatMoney(c, currency);
  return (
    <section aria-label="Fight or accept" className="rounded-lg border border-zinc-200 p-3 text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <span className="font-medium">Fight or accept</span>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          P(win)
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            step={1}
            value={pWin}
            onChange={(e) => onPWin(e.target.value)}
            aria-label="Probability of winning, percent"
            className="h-8 w-20 rounded-md border border-zinc-200 px-2 text-right text-sm text-foreground tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
          />
          %
        </label>
        {a ? (
          <Pill tone={a.recommendation === "FIGHT" ? "indigo" : "grey"}>Recommended: {RECOMMENDATION_LABELS[a.recommendation]}</Pill>
        ) : null}
      </div>
      {currency !== NETWORK.feeCurrency ? (
        <p className="text-xs text-muted-foreground">No recommendation: the network&apos;s fees are in {NETWORK.feeCurrency}.</p>
      ) : pct === null ? (
        <p className="text-xs text-muted-foreground">Enter your estimate of the chance to win pre-arbitration (0–100) to see the expected value.</p>
      ) : !a ? (
        <p className="text-xs text-red-700">P(win) must be a whole number from 0 to 100.</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1 text-xs tabular-nums">
          <dt className="text-muted-foreground">Expected recovery</dt>
          <dd className="text-muted-foreground">{a.pWinPct}% × {money(amountCents)}</dd>
          <dd className="text-right">{money(a.expectedRecoveryCents)}</dd>
          <dt className="text-muted-foreground">Expected cost</dt>
          <dd className="text-muted-foreground">
            {money(a.preArbFeeCents)} pre-arb fee + {100 - a.pWinPct}% × {money(NETWORK.arbitrationFeeCents)} arbitration + {money(a.handlingCostCents)} handling
          </dd>
          <dd className="text-right">−{money(a.expectedCostCents)}</dd>
          <dt className="font-medium">Expected value</dt>
          <dd className="text-muted-foreground">fight if above $0.00</dd>
          <dd className={cn("text-right font-medium", a.expectedValueCents > 0 ? "text-emerald-700" : "text-red-700")}>{formatSignedMoney(a.expectedValueCents, currency)}</dd>
        </dl>
      )}
      <p className="mt-2 text-xs text-muted-foreground">A recommendation from the numbers above only. You choose the decision.</p>
    </section>
  );
}

function SavedRecommendation({ dispute: d }: { dispute: DisputeView }) {
  if (d.pWinPct === null || d.expectedValueCents === null || !d.recommendation) return null;
  const follows = d.decisionType ? followsRecommendation(d.decisionType, d.recommendation) : null;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>
        P(win) {d.pWinPct}% · expected value {formatSignedMoney(d.expectedValueCents, d.currency)} · recommended: {RECOMMENDATION_LABELS[d.recommendation] ?? d.recommendation}
      </span>
      {follows === null ? null : follows ? <Pill tone="green">Follows recommendation</Pill> : <Pill tone="amber">Differs from recommendation</Pill>}
    </p>
  );
}
