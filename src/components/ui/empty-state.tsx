import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Empty state ajuda, nunca informa vazio.
 * Título na voz do produto (serif) + uma orientação + uma ação.
 *
 * `size="sm"` é para estado rotineiro (o dia acabou, a busca não achou):
 * merece explicação, não meia tela de espaço morto.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = "md",
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
  size?: "md" | "sm";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center px-6 text-center",
        size === "md" ? "py-12" : "py-8",
        className,
      )}
    >
      {Icon ? (
        <span
          className={cn(
            "mb-3 flex items-center justify-center rounded-full bg-surface-sunken text-ink-tertiary",
            size === "md" ? "size-10" : "size-8",
          )}
        >
          <Icon className={size === "md" ? "size-[18px]" : "size-4"} />
        </span>
      ) : null}
      <h3 className={cn("font-display text-ink", size === "md" ? "text-entity" : "text-card")}>
        {title}
      </h3>
      <p className="mt-1.5 max-w-[42ch] text-body text-ink-secondary">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
