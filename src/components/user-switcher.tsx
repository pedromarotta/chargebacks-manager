"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { initials, ROLE_LABELS } from "@/lib/format";
import { postJson } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface Props {
  users: { id: string; name: string; role: string }[];
  currentId: string | null;
}

/** Dev-only one-click user switch (simulated login). */
export function UserSwitcher({ users, currentId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function switchTo(id: string) {
    const result = await postJson("/api/session", { userId: id });
    toast.dismiss();
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div role="group" aria-label="Switch user" className={cn("flex items-center gap-1", pending && "opacity-60")}>
      <span className="mr-1 text-xs text-muted-foreground">Act as</span>
      {users.map((u) => {
        const active = u.id === currentId;
        return (
          <button
            key={u.id}
            type="button"
            onClick={() => switchTo(u.id)}
            aria-pressed={active}
            title={`${u.name} · ${ROLE_LABELS[u.role] ?? u.role}`}
            aria-label={`Act as ${u.name} (${ROLE_LABELS[u.role] ?? u.role})`}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-indigo-600",
              active ? "border-indigo-600 bg-indigo-600 text-white" : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100",
            )}
          >
            <span aria-hidden className="font-semibold">{initials(u.name)}</span>
            <span>{u.name.split(" ")[0]}</span>
            <span className={cn("text-[10px]", active ? "text-indigo-100" : "text-muted-foreground")}>
              {ROLE_LABELS[u.role] ?? u.role}
            </span>
          </button>
        );
      })}
    </div>
  );
}
