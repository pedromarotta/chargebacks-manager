"use client";

import { useRouter } from "next/navigation";
import { Download, Paperclip } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { InlineAlert } from "@/components/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { postForm, postJson } from "@/lib/api-client";
import { formatBytes, formatDateTime } from "@/lib/format";
import type { EvidenceView } from "@/server/disputes/view";

interface Props {
  disputeId: string;
  items: EvidenceView[];
  canEdit: boolean;
  names: Record<string, string>;
}

export function EvidenceChecklist({ disputeId, items, canEdit, names }: Props) {
  const router = useRouter();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(key: string, checked: boolean) {
    setPendingKey(key);
    const result = await postJson(`/api/disputes/${encodeURIComponent(disputeId)}/evidence`, { key, checked });
    setPendingKey(null);
    if (!result.ok) {
      setError(result.message);
      toast.error(result.message);
    } else {
      setError(null);
    }
    router.refresh();
  }

  async function upload(key: string, file: File) {
    setPendingKey(key);
    const form = new FormData();
    form.set("key", key);
    form.set("file", file);
    const result = await postForm(`/api/disputes/${encodeURIComponent(disputeId)}/files`, form);
    setPendingKey(null);
    if (!result.ok) {
      setError(result.message);
      toast.error(result.message);
    } else {
      setError(null);
      toast.success(`Attached ${file.name}`);
    }
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Evidence</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {error ? <InlineAlert message={error} /> : null}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No evidence items for this reason code.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-100">
            {items.map((item) => {
              const id = `ev-${item.key}`;
              return (
                <li key={item.key} className="flex flex-col py-1 text-sm">
                  <div className="flex h-11 items-center gap-3">
                  <input
                    id={id}
                    type="checkbox"
                    className="size-4 accent-indigo-600"
                    checked={item.checked}
                    disabled={!canEdit || pendingKey !== null}
                    onChange={(e) => toggle(item.key, e.target.checked)}
                  />
                  <label htmlFor={id} className="flex-1">
                    {item.label}
                    {item.required ? <span className="ml-2 text-xs text-amber-700">Required</span> : <span className="ml-2 text-xs text-muted-foreground">Optional</span>}
                  </label>
                  {item.checked && item.checkedBy ? (
                    <span className="text-xs text-muted-foreground">Checked by {names[item.checkedBy] ?? item.checkedBy}</span>
                  ) : null}
                  {canEdit ? (
                    <AttachButton label={item.label} disabled={pendingKey !== null} onFile={(f) => upload(item.key, f)} />
                  ) : null}
                  </div>
                  {item.files.length > 0 ? (
                    <ul aria-label={`Files for ${item.label}`} className="mb-2 ml-7 flex flex-col gap-1">
                      {item.files.map((f) => (
                        <li key={f.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <a
                            href={`/api/disputes/${encodeURIComponent(disputeId)}/files/${f.id}`}
                            className="inline-flex items-center gap-1 font-medium text-indigo-700 hover:underline"
                          >
                            <Download className="size-3" aria-hidden />
                            {f.filename}
                          </a>
                          <span>
                            {formatBytes(f.sizeBytes)} · {names[f.uploadedBy] ?? f.uploadedBy} · {formatDateTime(f.uploadedAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AttachButton({ label, disabled, onFile }: { label: string; disabled: boolean; onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
        className="hidden"
        aria-label={`Attach file to ${label}`}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-zinc-600 outline-none hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-50"
      >
        <Paperclip className="size-3.5" aria-hidden />
        Attach
      </button>
    </>
  );
}
