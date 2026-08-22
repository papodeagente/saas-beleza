import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Número operacional. Um componente só para os três lugares que antes tinham
 * três implementações (Hoje, Financeiro, ficha do cliente).
 */
export function Metric({
  label,
  value,
  hint,
  tone = "neutral",
  size = "md",
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
  tone?: "neutral" | "positive" | "danger" | "attention";
  size?: "md" | "sm";
}) {
  return (
    <div className="bg-surface-raised px-4 py-3.5">
      <p className="text-caption text-ink-secondary">{label}</p>
      <p
        className={cn(
          "mt-1 tabular",
          size === "md" ? "text-metric" : "text-entity",
          tone === "positive" && "text-positive",
          tone === "danger" && "text-danger",
          tone === "attention" && "text-attention",
          tone === "neutral" && "text-ink",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-meta text-ink-secondary">{hint}</p> : null}
    </div>
  );
}

/**
 * Faixa de métricas: células separadas por hairline, sem virar caixa dentro de
 * caixa. O `bg-line` com `gap-px` desenha as divisórias.
 */
export function MetricRow({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-4",
        className,
      )}
      {...props}
    />
  );
}
