"use client";

import * as SheetPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Painel contextual — o padrão de interação do produto.
 * Clicar numa entidade abre contexto + ações sem tirar o usuário da tela.
 */

export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;

export function SheetContent({
  className,
  children,
  title,
  description,
  footer,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  title: string;
  description?: string;
  /** Ações principais — ficam ancoradas no rodapé, fora da área que rola. */
  footer?: React.ReactNode;
}) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="animate-overlay-in fixed inset-0 z-50 bg-ink/20 backdrop-blur-[2px]" />
      <SheetPrimitive.Content
        className={cn(
          "animate-sheet-in fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col bg-surface-raised shadow-[var(--shadow-overlay)] outline-none sm:border-l sm:border-line",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <SheetPrimitive.Title className="truncate text-[15px] font-semibold text-ink">
              {title}
            </SheetPrimitive.Title>
            {description ? (
              <SheetPrimitive.Description className="mt-0.5 text-[12px] text-ink-tertiary">
                {description}
              </SheetPrimitive.Description>
            ) : (
              <SheetPrimitive.Description className="sr-only">{title}</SheetPrimitive.Description>
            )}
          </div>
          <SheetPrimitive.Close
            className="-mr-1 rounded-control p-1.5 text-ink-tertiary transition-colors hover:bg-surface-sunken hover:text-ink"
            aria-label="Fechar painel"
          >
            <X className="size-4" />
          </SheetPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-line bg-surface px-5 py-3">
            {footer}
          </div>
        ) : null}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}
