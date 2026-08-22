import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Select nativo estilizado. Nativo de propósito: no celular abre a roda do
 * sistema, que é mais rápida e acessível que qualquer lista customizada.
 */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { size?: "sm" | "md" }
>(({ className, size = "md", children, ...props }, ref) => (
  <div className="relative">
    <select
      ref={ref}
      className={cn(
        "w-full appearance-none rounded-control border border-line-strong bg-surface-raised pl-2.5 pr-8 text-label text-ink transition-colors duration-[120ms] hover:border-ink-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-surface-sunken disabled:text-ink-tertiary",
        size === "md" ? "h-9" : "h-8",
        className,
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown
      aria-hidden
      className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-tertiary"
    />
  </div>
));
Select.displayName = "Select";
