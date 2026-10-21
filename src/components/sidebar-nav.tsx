"use client";

import { BarChart3, History, Inbox, Upload } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/disputes", label: "Disputes", icon: Inbox },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/history", label: "History", icon: History },
];

export function SidebarNav() {
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
          </Link>
        );
      })}
      <span className="flex h-9 items-center gap-2 rounded-md px-2 text-sm text-zinc-400" aria-disabled="true">
        <BarChart3 className="size-4" aria-hidden />
        Metrics
        <span className="ml-auto text-[10px] uppercase tracking-wide">Soon</span>
      </span>
    </nav>
  );
}
