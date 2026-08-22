import { identityTint } from "@/lib/color";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts.at(-1)![0]).toUpperCase();
}

const SIZES = {
  sm: "size-6 text-meta",
  md: "size-8 text-meta",
  lg: "size-10 text-label",
} as const;

export function Avatar({
  name,
  size = "md",
  color,
  className,
}: {
  name: string;
  size?: keyof typeof SIZES;
  /** Cor de identidade (profissional). Pode ser qualquer valor cadastrado. */
  color?: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-medium",
        SIZES[size],
        !color && "bg-accent-soft text-accent",
        className,
      )}
      style={
        color
          ? (() => {
              // A cor cadastrada é livre e pode não ter contraste sobre o próprio
              // tom claro (a âmbar media 4,18:1). identityTint escurece só o
              // necessário para cruzar 4.5:1, preservando a identidade.
              const tint = identityTint(color);
              return { backgroundColor: tint.background, color: tint.foreground };
            })()
          : undefined
      }
    >
      {initials(name)}
    </span>
  );
}
