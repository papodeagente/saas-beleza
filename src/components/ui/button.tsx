import { Slot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

const button = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill font-semibold transition-[background-color,color,border-color,opacity,transform] duration-[120ms] ease-[var(--ease-out-quint)] active:scale-[0.985] disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-white shadow-[0_2px_8px_rgb(37_96_214/0.28)] hover:bg-accent-hover",
        secondary: "border border-accent/35 bg-surface-raised text-accent hover:bg-accent-soft",
        ghost: "text-ink-secondary hover:bg-surface-sunken hover:text-ink",
        danger: "bg-danger text-white hover:brightness-95",
        link: "h-auto p-0 text-accent underline-offset-4 hover:underline",
      },
      size: {
        // Alturas alinhadas com os controles de formulário (36/32) e o alvo de
        // toque mínimo do mobile (44) no tamanho lg.
        // `pointer-coarse` eleva o alvo para 44px só onde se toca com o dedo;
        // no mouse a densidade compacta é preservada.
        sm: "h-9 px-4 text-label pointer-coarse:min-h-11 [&_svg]:size-3.5",
        md: "h-10 px-5 text-label pointer-coarse:min-h-11 [&_svg]:size-4",
        lg: "h-12 px-6 text-body font-semibold [&_svg]:size-4",
        icon: "size-10 pointer-coarse:min-h-11 pointer-coarse:min-w-11 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">,
    VariantProps<typeof button> {
  asChild?: boolean;
  /** Mostra o giro e bloqueia o clique sem alterar a largura do botão. */
  loading?: boolean;
  children?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    if (asChild) {
      return (
        <Comp ref={ref} className={cn(button({ variant, size }), className)} {...props}>
          {children}
        </Comp>
      );
    }
    return (
      <button
        ref={ref}
        className={cn(button({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {/* O conteúdo some por opacidade em vez de ser removido: o botão não
            muda de largura ao entrar em carregamento. */}
        <span className={cn("inline-flex items-center gap-2", loading && "opacity-0")}>{children}</span>
        {loading ? (
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="size-4 animate-spin" />
          </span>
        ) : null}
      </button>
    );
  },
);
Button.displayName = "Button";

export { button as buttonVariants };
