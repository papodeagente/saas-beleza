import { cn } from "@/lib/utils";

/** Símbolo vetorial da Agenda de Unha. Mantém proporção, cor única e área de respiro. */
export function BrandIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label="Agenda de Unha"
      className={cn("shrink-0", className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M14 11h27a9 9 0 0 1 9 9v22a9 9 0 0 1-9 9H16a9 9 0 0 1-9-9V20a9 9 0 0 1 7-8.7Z" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M17 6v12M40 6v12" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      {[18, 28, 38].flatMap((x) => [28, 38].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2.2" fill="currentColor" />))}
      <path d="M31 50c8.5-12.7 15.6-18.9 21.1-18.4 3.9.4 5.7 3.2 5.1 7.1-.8 5.2-7.6 8.5-15.5 8.3" fill="var(--brand-nail-fill, currentColor)" />
      <path d="M32 58 47 43" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M45.5 34.5c3.6-2.7 7-3.5 9.5-1.7" stroke="white" strokeOpacity=".55" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function BrandLogo({
  className,
  iconClassName,
  compact = false,
}: {
  className?: string;
  iconClassName?: string;
  compact?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-3 text-accent", className)} aria-label="Agenda de Unha">
      <BrandIcon className={cn(compact ? "size-8" : "size-12", iconClassName)} />
      <span className="min-w-0">
        <span className={cn("block whitespace-nowrap font-brand leading-none tracking-[-0.025em]", compact ? "text-[21px]" : "text-[30px]")}>Agenda de Unha</span>
        {!compact ? (
          <span className="mt-1.5 block whitespace-nowrap text-[7px] font-semibold uppercase leading-none tracking-[0.23em]">
            Gestão inteligente para manicures
          </span>
        ) : null}
      </span>
    </span>
  );
}

