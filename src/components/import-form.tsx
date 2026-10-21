"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Pill } from "@/components/status-badge";
import { InlineAlert } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { postJson } from "@/lib/api-client";
import { formatMoney, REASON_LABELS, STATUS_LABELS } from "@/lib/format";
import type { ImportResult } from "@/server/disputes/service";
import { CheckCircle2, Copy, XCircle } from "lucide-react";

export function ImportForm({ canImport }: { canImport: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(f: File | undefined) {
    setPreview(null);
    setDone(null);
    setError(null);
    if (!f) return setFile(null);
    const text = await f.text();
    setFile({ name: f.name, text });
    setBusy(true);
    const result = await postJson<ImportResult>("/api/import", { csv: text, filename: f.name, dryRun: true });
    setBusy(false);
    if (result.ok) setPreview(result.data);
    else {
      setError(result.message);
      toast.error(result.message);
    }
    router.refresh();
  }

  async function confirm() {
    if (!file) return;
    setBusy(true);
    const result = await postJson<ImportResult>("/api/import", { csv: file.text, filename: file.name });
    setBusy(false);
    if (result.ok) {
      setDone(result.data);
      setPreview(null);
      setFile(null);
      setError(null);
      if (inputRef.current) inputRef.current.value = "";
      toast.success(`Imported ${result.data.imported} · Rejected ${result.data.rejected} · Duplicates ${result.data.duplicates} · Merchant responses ${result.data.representments}`);
    } else {
      setError(result.message);
      toast.error(result.message);
    }
    router.refresh();
  }

  const shown = done ?? preview;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Disputes file (CSV)</span>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(e) => onFile(e.target.files?.[0])}
            className="text-sm file:mr-3 file:h-8 file:rounded-md file:border file:border-zinc-200 file:bg-white file:px-3 file:text-sm"
          />
        </label>
        {!canImport ? <p className="text-xs text-muted-foreground">Your role can preview but not import files.</p> : null}
      </div>

      {error ? <InlineAlert message={error} /> : null}

      {done ? (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          Imported {done.imported} · Rejected {done.rejected} · Duplicates {done.duplicates} · Merchant responses {done.representments}
        </div>
      ) : null}

      {preview ? (
        <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm">
          <span>
            Preview of <span className="font-medium">{file?.name}</span>: {preview.imported} valid · {preview.rejected} rejected · {preview.duplicates} duplicates · {preview.representments} merchant responses
          </span>
          <Button onClick={confirm} disabled={busy || preview.imported + preview.representments === 0}>
            {busy
              ? "Importing…"
              : preview.representments > 0
                ? `Confirm import of ${preview.imported} and ${preview.representments} merchant responses`
                : `Confirm import of ${preview.imported}`}
          </Button>
        </div>
      ) : null}

      {shown ? (
        <div className="rounded-lg border border-zinc-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">Row</TableHead>
                <TableHead>Case</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Merchant</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(done ? shown.rows.filter((r) => r.result !== "IMPORTED") : shown.rows).map((r) => (
                <TableRow key={r.rowNumber} className="h-11">
                  <TableCell className="tabular-nums">{r.rowNumber}</TableCell>
                  <TableCell className="font-medium">{r.caseId ?? "—"}</TableCell>
                  <TableCell>
                    {r.result === "REJECTED" ? (
                      <Pill tone="red" icon={XCircle}>Rejected</Pill>
                    ) : r.result === "REPRESENTMENT" ? (
                      <Pill tone="indigo">Merchant response</Pill>
                    ) : r.result === "DUPLICATE" ? (
                      <Pill tone="grey" icon={Copy}>Duplicate</Pill>
                    ) : (
                      <Pill tone="green" icon={CheckCircle2}>{r.result === "IMPORTED" ? "Imported" : "Valid"}</Pill>
                    )}
                  </TableCell>
                  <TableCell>{r.row?.client ?? ""}</TableCell>
                  <TableCell>{r.row?.merchant ?? ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.row ? formatMoney(r.row.amountCents, r.row.currency) : ""}</TableCell>
                  <TableCell>{r.row ? REASON_LABELS[r.row.reasonCode] ?? r.row.reasonCode : ""}</TableCell>
                  <TableCell className="text-xs">
                    {r.reasons.length > 0 ? r.reasons.join("; ") : r.result === "REPRESENTMENT" ? "Records the merchant response on the filed case" : r.row ? `Opens as ${r.row.hasMerchantResponse ? STATUS_LABELS.REPRESENTMENT_RECEIVED : STATUS_LABELS.NEW}` : ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {done && done.rejected + done.duplicates === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Every row was imported.</p>
          ) : null}
        </div>
      ) : !busy && !error ? (
        <p className="text-sm text-muted-foreground">No file chosen yet. Run <code>npm run sample</code> to regenerate samples/disputes-today.csv.</p>
      ) : busy ? (
        <p role="status" className="text-sm text-muted-foreground">Checking the file…</p>
      ) : null}
    </div>
  );
}
