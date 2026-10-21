import { getCurrentUser } from "@/server/auth";
import { listUsers } from "@/server/disputes/queries";
import { ROLE_LABELS } from "@/lib/format";
import { SidebarNav } from "./sidebar-nav";
import { UserSwitcher } from "./user-switcher";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const [user, users] = await Promise.all([getCurrentUser(), listUsers()]);
  return (
    <div className="flex min-h-screen bg-zinc-50 text-zinc-900">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-zinc-200 bg-white">
        <div className="px-4 py-4">
          <div className="text-sm font-semibold">Chargebacks Manager</div>
          <div className="text-xs text-muted-foreground">Internal tools</div>
        </div>
        <SidebarNav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b border-zinc-200 bg-white/95 px-6 backdrop-blur">
          <div className="text-sm" aria-live="polite">
            {user ? (
              <>
                <span className="font-medium">{user.name}</span>
                <span className="text-muted-foreground"> · {ROLE_LABELS[user.role] ?? user.role}</span>
              </>
            ) : (
              <span className="text-muted-foreground">Not signed in</span>
            )}
          </div>
          <UserSwitcher users={users} currentId={user?.id ?? null} />
        </header>
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
