import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Vocabulário visual da landing.
 *
 * A regra que faz a página parecer de um único autor é a repetição rígida:
 * toda seção abre com o MESMO trio (rótulo em pílula, título curto, um
 * parágrafo de no máximo 60 caracteres por linha) e usa o MESMO par de
 * espaçamentos. Variar isso "só nesta seção" é como a página começa a
 * desmanchar.
 */

/** Par de espaçamentos de seção, idêntico em todas elas. */
export const SECTION_PAD = "px-[clamp(20px,4vw,32px)] py-[clamp(56px,7vw,104px)]";
export const CONTAINER = "mx-auto w-full max-w-[1200px]";

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-pill border border-accent-lift/30 bg-accent-lift/10 px-3 py-1 text-eyebrow text-accent-lift">
      <span aria-hidden className="size-1.5 rounded-pill bg-accent-lift" />
      {children}
    </span>
  );
}

export function SectionHead({
  eyebrow,
  title,
  description,
  align = "center",
  className,
}: {
  eyebrow: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "center" | "left";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "max-w-[760px]",
        align === "center" ? "mx-auto text-center" : "text-left",
        className,
      )}
    >
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-4 text-balance text-section-title text-night-ink">{title}</h2>
      {description ? (
        <p
          className={cn(
            "mt-4 max-w-[62ch] text-pretty text-lede text-night-ink-secondary",
            align === "center" && "mx-auto",
          )}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Moldura de navegador em volta do print.
 *
 * A URL é conteúdo, não enfeite: ela muda por seção e diz em que tela do
 * produto o leitor está olhando. O raio interno (12px) é o externo (28px) menos
 * o respiro (16px) — é o que faz os cantos parecerem concêntricos em vez de
 * apenas arredondados.
 */
export function BrowserFrame({
  url,
  children,
  className,
}: {
  url: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[28px] border border-night-line-strong bg-night-raised p-2.5 shadow-hero sm:p-4",
        className,
      )}
    >
      <div className="flex items-center gap-2 px-1 pb-2.5 sm:pb-3">
        <span aria-hidden className="flex gap-1.5">
          <span className="size-2.5 rounded-pill bg-[#ff5f57]" />
          <span className="size-2.5 rounded-pill bg-[#febc2e]" />
          <span className="size-2.5 rounded-pill bg-[#28c840]" />
        </span>
        <span className="ml-1 flex min-w-0 flex-1 items-center gap-1.5 rounded-pill bg-night-sunken px-3 py-1 text-meta text-night-ink-tertiary">
          <svg aria-hidden viewBox="0 0 24 24" className="size-3 shrink-0" fill="currentColor">
            <path d="M17 9V7a5 5 0 0 0-10 0v2a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-6a3 3 0 0 0-3-3ZM9 7a3 3 0 1 1 6 0v2H9V7Z" />
          </svg>
          <span className="truncate">{url}</span>
        </span>
      </div>
      <div className="overflow-hidden rounded-[12px] bg-surface">{children}</div>
    </div>
  );
}

/**
 * Botão da landing.
 *
 * Deliberadamente separado do Button de ui/: aquele foi calibrado para o
 * produto claro, e reaproveitá-lo aqui obrigaria a sobrescrever cor de fundo,
 * borda e texto em toda chamada. Dois componentes honestos custam menos que um
 * componente disfarçado.
 */
export function CtaButton({
  href,
  children,
  variant = "primary",
  external,
  className,
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "ghost";
  external?: boolean;
  className?: string;
}) {
  const base =
    "inline-flex h-12 items-center justify-center gap-2 rounded-control px-6 text-[15px] font-semibold tracking-[-0.011em] transition-colors duration-150";
  const estilo =
    variant === "primary"
      ? // O fundo do botão contra a noite mede 2,66:1 — abaixo dos 3:1 que um
        // controle precisa ter de contorno, então sozinho ele desapareceria na
        // seção escura. Quem faz o recorte é o anel em accent-lift, que mede
        // 9,35:1 contra o mesmo fundo. O texto branco sobre o botão dá 7,06:1.
        "bg-accent text-white shadow-[0_0_0_1px_var(--color-accent-lift)] hover:bg-accent-hover"
      : "border border-night-line-strong text-night-ink hover:bg-white/6";

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(base, estilo, className)}
      >
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={cn(base, estilo, className)}>
      {children}
    </Link>
  );
}

export function ArrowRight({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
    >
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}
