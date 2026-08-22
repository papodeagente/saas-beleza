"use client";

import { Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { CustomerFilter } from "@/server/services/customer-service";

export function CustomerSearch({
  initialQuery,
  filter,
  filters,
}: {
  initialQuery: string;
  filter: CustomerFilter;
  filters: Array<{ value: CustomerFilter; label: string }>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  const [, startTransition] = useTransition();

  // A busca acontece no servidor — a lista nunca é filtrada só no que já veio
  useEffect(() => {
    if (query === initialQuery) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (query.trim()) params.set("busca", query.trim());
      else params.delete("busca");
      startTransition(() => router.replace(`/clientes?${params.toString()}`));
    }, 260);
    return () => clearTimeout(timer);
  }, [query, initialQuery, router, searchParams]);

  function setFilter(value: CustomerFilter) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "todos") params.delete("filtro");
    else params.set("filtro", value);
    router.replace(`/clientes?${params.toString()}`);
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative w-full sm:max-w-[280px]">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-tertiary" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nome ou telefone"
          className="pl-8"
          aria-label="Buscar cliente"
        />
      </div>

      <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar clientes">
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
