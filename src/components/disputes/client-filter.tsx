"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function ClientFilter({ clients, value }: { clients: string[]; value: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Client</span>
      <select
        className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
        value={value ?? ""}
        onChange={(e) => {
          const params = new URLSearchParams(searchParams.toString());
          if (e.target.value) params.set("client", e.target.value);
          else params.delete("client");
          const qs = params.toString();
          router.push(qs ? `${pathname}?${qs}` : pathname);
        }}
      >
        <option value="">All clients</option>
        {clients.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
}
