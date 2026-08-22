import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("rounded-control bg-surface-sunken", className)}
      style={{
        backgroundImage:
          "linear-gradient(90deg, var(--color-surface-sunken) 0%, #EDEAE5 50%, var(--color-surface-sunken) 100%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.6s linear infinite",
      }}
    />
  );
}
