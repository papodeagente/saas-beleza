"use client";

import { Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AccountFilter } from "@/server/services/platform-accounts";

/**
 * Busca e situação vivem na URL: um link para "as inadimplentes com 'aurora'"
 * é o jeito de duas pessoas olharem exatamente a mesma lista. A filtragem é
 * feita pelo servidor — nunca sobre a página que já veio.
 */
export function AccountFilters({
  initialQuery,
  filter,
  filters,
}: {
  initialQuery: string;
  filter: AccountFilter;
  filters: Array<{ value: AccountFilter; label: string }>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (query.trim() === initialQuery) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (query.trim()) params.set("busca", query.trim());
      else params.delete("busca");
      startTransition(() => router.replace(`/admin/contas?${params.toString()}`));
    }, 260);
    return () => clearTimeout(timer);
  }, [query, initialQuery, router, searchParams]);

  function setFilter(value: AccountFilter) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "todas") params.delete("filtro");
    else params.set("filtro", value);
    startTransition(() => router.replace(`/admin/contas?${params.toString()}`));
  }

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="relative w-full lg:max-w-[300px]">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-tertiary"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por código, nome ou endereço"
          className="pl-8"
          aria-label="Buscar conta"
        />
      </div>

      <div
        className={cn("flex flex-wrap gap-1 transition-opacity", pending && "opacity-60")}
        role="group"
        aria-label="Filtrar contas por situação"
      >
        {filters.map((option) => {
          const active = option.value === filter;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              aria-pressed={active}
              className={cn(
                "h-7 rounded-control px-2.5 text-caption transition-colors duration-[120ms] pointer-coarse:min-h-11",
                active
                  ? "bg-accent-soft font-medium text-accent"
                  : "text-ink-secondary hover:bg-surface-sunken hover:text-ink",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
