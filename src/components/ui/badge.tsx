import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badge = cva(
  "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-caption font-semibold",
  {
    variants: {
      tone: {
        neutral: "bg-surface-sunken text-ink-secondary",
        accent: "bg-accent-soft text-accent",
        positive: "bg-positive-soft text-positive",
        attention: "bg-attention-soft text-attention",
        danger: "bg-danger-soft text-danger",
        info: "bg-info-soft text-info",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...props} />;
}
