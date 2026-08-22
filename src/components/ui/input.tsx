import * as React from "react";
import { cn } from "@/lib/utils";

const field =
  "w-full rounded-control border border-line-strong bg-surface-raised text-label text-ink transition-colors duration-[120ms] placeholder:text-ink-tertiary hover:border-ink-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-surface-sunken disabled:text-ink-tertiary aria-invalid:border-danger aria-invalid:ring-danger/15";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(field, "h-9 px-2.5 pointer-coarse:min-h-11", className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(field, "px-2.5 py-2", className)} {...props} />
));
Textarea.displayName = "Textarea";

/**
 * Campo de formulário. O erro é associado ao input por aria-describedby —
 * sem isso o leitor de tela anuncia o campo sem dizer o que está errado.
 */
export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  optional,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  const describedBy = htmlFor ? `${htmlFor}-desc` : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="flex items-baseline gap-1.5 text-label text-ink">
        {label}
        {optional ? <span className="text-caption text-ink-tertiary">(opcional)</span> : null}
      </label>
      {children}
      {error ? (
        <p id={describedBy} role="alert" className="text-caption text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={describedBy} className="text-caption text-ink-tertiary">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
