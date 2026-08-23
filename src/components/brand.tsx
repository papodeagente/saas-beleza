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
  compact = false,
  variant = "color",
}: {
  className?: string;
  compact?: boolean;
  variant?: "color" | "white";
}) {
  return (
    <span className={cn("inline-flex shrink-0 items-center", className)} aria-label="Agenda de Unha">
      {/* Arquivo oficial fornecido pela marca. Mantido sem recorte ou tratamento. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={variant === "white" ? "/brand/agenda-de-unha-white.png" : "/brand/agenda-de-unha-color.png"}
        alt="Agenda de Unha — Gestão inteligente para manicures"
        width={2172}
        height={724}
        className={cn("block w-auto object-contain", compact ? "h-12" : "h-20")}
      />
    </span>
  );
}
