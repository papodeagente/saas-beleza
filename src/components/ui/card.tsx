import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Superfície de conteúdo.
 *
 * Card em página NÃO tem sombra — o corpo vem do raio e do agrupamento.
 * Elevação é privilégio de quem flutua (overlay) ou adere (sticky).
 */
export function Card({
  className,
  inset = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  /** `inset` usa o fundo rebaixado, para blocos dentro de outro card. */
  inset?: boolean;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-card",
        inset ? "bg-surface" : "bg-surface-raised shadow-card",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  action,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3 px-4 py-3", className)}>
      <h3 className="text-card text-ink">{title}</h3>
      {action}
    </div>
  );
}

/** Lista com separadores hairline — o padrão de linha do produto. */
export function CardList({ className, ...props }: React.HTMLAttributes<HTMLUListElement>) {
  return <ul className={cn("divide-y divide-line", className)} {...props} />;
}

/**
 * Par rótulo/valor. É a unidade de leitura das fichas — usada na ficha do
 * cliente, no painel do atendimento e no contexto do Inbox.
 */
export function DataRow({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-1.5", className)}>
      <dt className="shrink-0 text-caption text-ink-tertiary">{label}</dt>
      <dd className="min-w-0 text-right text-label font-normal text-ink">{children}</dd>
    </div>
  );
}
