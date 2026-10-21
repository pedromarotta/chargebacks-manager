"use client";

import { AlarmClock, BarChart3, History, Inbox, Landmark, Upload } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/disputes", label: "Disputes", icon: Inbox },
  { href: "/due-soon", label: "Due soon", icon: AlarmClock },
  { href: "/funds", label: "Funds", icon: Landmark },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/history", label: "History", icon: History },
  { href: "/metrics", label: "Metrics", icon: BarChart3 },
];

export function SidebarNav({ dueSoon = 0, fundsAlerts = 0 }: { dueSoon?: number; fundsAlerts?: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-2">
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-9 items-center gap-2 rounded-md px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-600",
              active ? "bg-indigo-50 font-medium text-indigo-700" : "text-zinc-700 hover:bg-zinc-100",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
            {href === "/due-soon" && dueSoon > 0 ? (
              <span className="ml-auto rounded-full bg-amber-100 px-1.5 text-xs font-medium tabular-nums text-amber-800" aria-label={`${dueSoon} due soon`}>
                {dueSoon}
              </span>
            ) : null}
            {href === "/funds" && fundsAlerts > 0 ? (
              <span className="ml-auto rounded-full bg-red-100 px-1.5 text-xs font-medium tabular-nums text-red-800" aria-label={`${fundsAlerts} funds alerts`}>
                {fundsAlerts}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
