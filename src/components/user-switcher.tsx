"use client";

import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { switchUser } from "@/app/actions/session";
import { initials, ROLE_LABELS } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  users: { id: string; name: string; role: string }[];
  currentId: string | null;
}

/** Dev-only one-click user switch (simulated login). A plain form, so a click before hydration still signs in. */
export function UserSwitcher({ users, currentId }: Props) {
  return (
    <form action={switchUser} onSubmit={() => toast.dismiss()}>
      <SwitcherButtons users={users} currentId={currentId} />
    </form>
  );
}

function SwitcherButtons({ users, currentId }: Props) {
  const { pending } = useFormStatus();
  return (
    <div role="group" aria-label="Switch user" className={cn("flex items-center gap-1", pending && "opacity-60")}>
      <span className="mr-1 text-xs text-muted-foreground">Act as</span>
      {users.map((u) => {
        const active = u.id === currentId;
        return (
          <button
            key={u.id}
            type="submit"
            name="userId"
            value={u.id}
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
