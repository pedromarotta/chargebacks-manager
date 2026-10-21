"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";

export interface BulkCandidate {
  id: string;
  amountCents: number;
  currency: string;
}

interface Ctx {
  selected: Set<string>;
  toggle: (id: string) => void;
  setAll: (on: boolean) => void;
  candidates: BulkCandidate[];
}

const BulkContext = createContext<Ctx | null>(null);

interface BulkResponse {
  writtenOff: number;
  refused: number;
  results: { id: string; ok: boolean; message?: string }[];
}

/** Backlog 4: selection state for bulk write-off on the queue. Only eligible rows get a checkbox. */
export function BulkWriteOff({ candidates, children }: { candidates: BulkCandidate[]; children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const ctx = useMemo<Ctx>(
    () => ({
      selected,
      candidates,
      toggle: (id) =>
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      setAll: (on) => setSelected(on ? new Set(candidates.map((c) => c.id)) : new Set()),
    }),
    [selected, candidates],
  );
  return (
    <BulkContext.Provider value={ctx}>
      <BulkBar />
      {children}
    </BulkContext.Provider>
  );
}

function useBulk(): Ctx | null {
  return useContext(BulkContext);
}

export function BulkCheckbox({ id }: { id: string }) {
  const ctx = useBulk();
  if (!ctx || !ctx.candidates.some((c) => c.id === id)) return null;
  return (
    <input
      type="checkbox"
      aria-label={`Select ${id} for bulk write-off`}
      checked={ctx.selected.has(id)}
      onChange={() => ctx.toggle(id)}
      className="size-4 accent-indigo-600"
    />
  );
}

export function BulkSelectAll() {
  const ctx = useBulk();
  if (!ctx || ctx.candidates.length === 0) return null;
  const all = ctx.selected.size === ctx.candidates.length;
  return (
    <input
      type="checkbox"
      aria-label="Select all cases eligible for bulk write-off"
      checked={all}
      onChange={() => ctx.setAll(!all)}
      className="size-4 accent-indigo-600"
    />
  );
}

function BulkBar() {
  const ctx = useBulk();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ctx || ctx.selected.size === 0) return null;
  const chosen = ctx.candidates.filter((c) => ctx.selected.has(c.id));
  const currency = chosen[0]?.currency ?? "USD";
  const total = chosen.reduce((sum, c) => sum + c.amountCents, 0);
  const n = chosen.length;

  async function submit() {
    setBusy(true);
    const r = await postJson<BulkResponse>("/api/disputes/bulk-write-off", { ids: chosen.map((c) => c.id), note });
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      toast.error(r.message);
      return;
    }
    setError(null);
    setNote("");
    ctx?.setAll(false);
    const refused = r.data.results.filter((x) => !x.ok);
    toast.success(`Wrote off ${r.data.writtenOff} ${r.data.writtenOff === 1 ? "case" : "cases"}.`);
    for (const x of refused) toast.error(`${x.id}: ${x.message}`);
    router.refresh();
  }

  return (
    <section aria-label="Bulk write-off" className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-sm">
      <span className="font-medium">
        {n} selected · {formatMoney(total, currency)}
      </span>
      <input
        aria-label="Bulk write-off note"
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          setError(null);
        }}
        placeholder="Why write these off? At least 10 characters."
        className="h-8 max-w-sm flex-1 rounded-md border border-zinc-200 bg-white px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
      />
      <Button size="sm" onClick={submit} disabled={busy}>
        {busy ? "Writing off…" : `Write off ${n} ${n === 1 ? "case" : "cases"}`}
      </Button>
      <button type="button" onClick={() => ctx.setAll(false)} className="text-xs text-muted-foreground hover:underline">
        Clear
      </button>
      {error ? (
        <p role="alert" className="w-full text-xs text-red-700">
          {error}
        </p>
      ) : null}
      <p className="w-full text-xs text-muted-foreground">Each case is written off on its own, with its own history row. The provisional credit stays with the cardholder.</p>
    </section>
  );
}
