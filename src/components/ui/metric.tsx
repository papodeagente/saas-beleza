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
    <div className="rounded-card bg-surface-raised px-5 py-4 shadow-card">
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

/** Grade de métricas: um card por número, com respiro entre eles. */
export function MetricRow({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("grid grid-cols-2 gap-3 sm:grid-cols-4", className)}
      {...props}
    />
  );
}
