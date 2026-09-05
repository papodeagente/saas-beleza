import { cn } from "@/lib/utils";

/**
 * Selo de status com pulso — a mesma linguagem visual repetida em três lugares
 * da landing: o indicador "IA ativa" no hero, a confirmação da jornada
 * animada e o passo ativo da linha do tempo de retorno.
 *
 * Puramente decorativo por natureza (o texto ao redor já diz o que está
 * acontecendo), então o pulso em si é `aria-hidden` — só o rótulo, quando
 * existe, é lido.
 */
export function AnimatedStatusBadge({
  label,
  tone = "accent",
  pulse = true,
  className,
}: {
  label?: string;
  tone?: "accent" | "positive";
  pulse?: boolean;
  className?: string;
}) {
  const cor = tone === "positive" ? "text-[#5fd6ac]" : "text-accent-lift";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border border-night-line-strong bg-night-raised/80 px-2.5 py-1 text-meta text-night-ink-secondary backdrop-blur-sm",
        className,
      )}
    >
      <span aria-hidden className={cn("relative size-1.5 shrink-0 rounded-pill", cor)}>
        <span className={cn("absolute inset-0 rounded-pill bg-current", pulse && "pulso-ponto")} />
      </span>
      {label ? <span>{label}</span> : null}
    </span>
  );
}
