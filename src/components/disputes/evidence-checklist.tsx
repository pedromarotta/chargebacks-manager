"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { InlineAlert } from "@/components/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { postJson } from "@/lib/api-client";
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
                <li key={item.key} className="flex h-11 items-center gap-3 text-sm">
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
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
