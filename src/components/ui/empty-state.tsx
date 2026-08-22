import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Empty state ajuda, nunca informa vazio.
 * Título na voz do produto (serif) + uma orientação + uma ação.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>
      {Icon ? (
        <span className="mb-4 flex size-10 items-center justify-center rounded-full bg-surface-sunken text-ink-tertiary">
          <Icon className="size-[18px]" />
        </span>
      ) : null}
      <h3 className="font-display text-[19px] leading-6 text-ink">{title}</h3>
      <p className="mt-1.5 max-w-[38ch] text-[13px] leading-5 text-ink-secondary">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
