import Link from "next/link";
import { notFound } from "next/navigation";
import { DecisionPanel } from "@/components/disputes/decision-panel";
import { EvidenceChecklist } from "@/components/disputes/evidence-checklist";
import { HistoryList } from "@/components/disputes/history-list";
import { Lifecycle } from "@/components/disputes/lifecycle";
import { buildTimeline } from "@/lib/timeline";
import { FundsPanel } from "@/components/disputes/funds-panel";
import { fundsInfo } from "@/lib/funds";
import { DueBadge, StatusBadge } from "@/components/status-badge";
import { SignInPrompt } from "@/components/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatDueIn, formatMoney, REASON_LABELS } from "@/lib/format";
import { getCurrentUser } from "@/server/auth";
import { getCase, listUsers } from "@/server/disputes/queries";
import { missingRequiredEvidence, needsApproval } from "@/server/disputes/rules";
import { NETWORK } from "@/server/network";
import { can } from "@/server/policy";

export const dynamic = "force-dynamic";

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return <SignInPrompt />;
  const now = new Date();
  const [result, users] = await Promise.all([getCase(user, id, now), listUsers()]);
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return <p className="text-sm">{result.message}</p>;
  }
  const { dispute: d, evidence, history, risk } = result.value;
  const names: Record<string, string> = { ...Object.fromEntries(users.map((u) => [u.id, u.name])), network: "Card network (simulated)" };
  // Remount client forms whenever the case changes or the user switches, so nothing stale survives.
  const formKey = `${user.id}:${d.updatedAt}`;

  const facts = [
    { label: "Client", value: d.client },
    { label: "Card", value: `•••• ${d.cardLast4}` },
    { label: "Reason", value: REASON_LABELS[d.reasonCode] ?? d.reasonCode },
    { label: "Provisional credit", value: formatMoney(d.provisionalCreditCents, d.currency) },
    { label: "Opened", value: formatDateTime(d.openedAt) },
    { label: "Network deadline", value: formatDateTime(d.dueAt) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Link href="/disputes" className="text-sm text-muted-foreground hover:text-zinc-900">
        ← Disputes
      </Link>
      <div className="grid grid-cols-[minmax(0,1fr)_400px] gap-6">
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">{d.id}</div>
                  <h1 className="text-2xl font-semibold tabular-nums">{formatMoney(d.amountCents, d.currency)}</h1>
                  <div className="text-sm">{d.merchant}</div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <StatusBadge status={d.status} />
                  <DueBadge risk={risk} dueIn={formatDueIn(d.dueAt, now)} />
                </div>
              </div>
              <dl className="grid grid-cols-3 gap-x-6 gap-y-3 text-sm">
                {facts.map((f) => (
                  <div key={f.label}>
                    <dt className="text-xs text-muted-foreground">{f.label}</dt>
                    <dd className="tabular-nums">{f.value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <EvidenceChecklist
            key={`ev-${formKey}`}
            disputeId={d.id}
            items={evidence}
            canEdit={can(user, "evidence:edit") && ["NEW", "CHARGEBACK_FILED", "REPRESENTMENT_RECEIVED"].includes(d.status)}
            names={names}
          />

          <Card>
            <CardHeader>
              <CardTitle>Merchant response</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {d.merchantResponse ? (
                <>
                  <p className="whitespace-pre-wrap">{d.merchantResponse}</p>
                  {d.representmentReceivedAt ? (
                    <p className="mt-2 text-xs text-muted-foreground">Received {formatDateTime(d.representmentReceivedAt)}</p>
                  ) : null}
                </>
              ) : (
                <p className="text-muted-foreground">No response from the merchant yet.</p>
              )}
            </CardContent>
          </Card>

          <DecisionPanel
            key={`dp-${formKey}`}
            dispute={d}
            userId={user.id}
            names={names}
            perms={{
              file: can(user, "dispute:file"),
              propose: can(user, "decision:propose"),
              // Shown to every non-auditor (including the proposer): the server is what refuses.
              decide: can(user, "decision:propose") || can(user, "decision:approve"),
            }}
            missingEvidence={missingRequiredEvidence(evidence).map((e) => e.label)}
            needsApproval={needsApproval(d.amountCents, d.currency)}
            preArbFee={formatMoney(NETWORK.preArbitrationFeeCents, NETWORK.feeCurrency)}
          />
          {d.status === "CLOSED_WON" ? (
            <FundsPanel
              key={`fp-${formKey}`}
              dispute={d}
              info={fundsInfo(d, new Date())}
              userId={user.id}
              names={names}
              perms={{ move: can(user, "funds:move"), approve: can(user, "funds:approve") }}
            />
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <Lifecycle steps={buildTimeline(d, history)} />
          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              <HistoryList rows={history} names={names} currency={d.currency} compact />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
