import { Bell, CalendarPlus, Check, Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Atendimento concluído → intervalo → lembrete → novo convite.
 *
 * Recebe `activeIndex` de fora (quem controla o tempo é `AnimatedBookingJourney`,
 * que já sabe pausar fora da viewport, com a aba oculta e sob
 * `prefers-reduced-motion`) — este componente só desenha o estado que recebe,
 * sem timer próprio.
 *
 * Puramente ilustrativo, então tudo aqui é `aria-hidden`: a frase de efeito
 * já escrita no `SectionHead` da seção ("a automação chama de volta no
 * intervalo ideal...") é a versão para quem lê com leitor de tela.
 */

const ETAPAS = [
  { label: "Atendimento concluído", icon: Check },
  { label: "Intervalo de manutenção", icon: Clock3 },
  { label: "Lembrete enviado", icon: Bell },
  { label: "Novo agendamento sugerido", icon: CalendarPlus },
];

export function RetentionTimeline({
  activeIndex,
  className,
}: {
  /** -1 = nada aceso ainda. */
  activeIndex: number;
  className?: string;
}) {
  return (
    <div aria-hidden className={cn("w-full", className)}>
      <div className="relative flex items-start justify-between">
        {/* O trilho — cinza por trás, roxo por cima até a etapa ativa. A
            largura do preenchido é só `transform: scaleX`, então o navegador
            não recalcula layout a cada passo. */}
        <div className="absolute left-0 right-0 top-[15px] h-px bg-night-line" />
        <div
          className="absolute left-0 top-[15px] h-px origin-left bg-accent-lift transition-transform duration-500 ease-out-quint"
          style={{
            right: 0,
            transform: `scaleX(${activeIndex < 0 ? 0 : activeIndex / (ETAPAS.length - 1)})`,
          }}
        />

        {ETAPAS.map((etapa, i) => {
          const feita = i < activeIndex;
          const ativa = i === activeIndex;
          return (
            <div key={etapa.label} className="relative flex w-16 flex-col items-center gap-2 sm:w-24">
              <span
                className={cn(
                  "flex size-[31px] shrink-0 items-center justify-center rounded-pill border transition-colors duration-300",
                  feita || ativa
                    ? "border-accent-lift bg-accent-lift text-night shadow-[0_0_0_4px_rgb(205_168_240_/_0.18)]"
                    : "border-night-line-strong bg-night text-night-ink-tertiary",
                )}
              >
                <etapa.icon className="size-3.5" strokeWidth={2.5} />
              </span>
              <span
                className={cn(
                  "text-center text-meta leading-[1.2] transition-colors duration-300",
                  feita || ativa ? "text-night-ink-secondary" : "text-night-ink-tertiary",
                )}
              >
                {etapa.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
