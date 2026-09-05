import { BellRing, CalendarCheck2, MessageCircle, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatedStatusBadge } from "./animated-status-badge";

/**
 * A atividade ambiente ao redor do print do hero.
 *
 * Puro CSS — sem estado, sem observer, sem `"use client"`. Os quatro
 * cartõezinhos comunicam que o sistema trabalha sozinho ("Nova cliente",
 * "Horário confirmado", "Lembrete enviado", "Retorno agendado"), flutuando
 * cada um no seu próprio ritmo por `flutuar` (ver globals.css). Tudo
 * `aria-hidden`: é reforço visual do que o título e o parágrafo já dizem, não
 * informação nova.
 *
 * Cada cartão tem posição própria em `CARTOES`, e o `minWidth` decide a partir
 * de que largura ele aparece — no celular NENHUM cartão de texto sobrevive
 * (a leitura de "flutuando" precisa de espaço em volta do painel que o
 * celular não tem); só o selo do agente de IA, colado no canto, continua
 * visível lá — é o único elemento que sozinho já comunica "isto está ligado
 * agora" sem precisar de espaço extra.
 */

type Cartao = {
  icon: typeof MessageCircle;
  texto: string;
  className: string;
  atraso: string;
  duracao: string;
  /** A partir de qual largura este cartão aparece — nenhum aparece abaixo de `sm`. */
  minWidth: "sm" | "lg";
};

const CARTOES: Cartao[] = [
  {
    icon: MessageCircle,
    texto: "Nova cliente",
    className: "-left-5 top-[14%] sm:-left-8",
    atraso: "0ms",
    duracao: "6.5s",
    minWidth: "sm",
  },
  {
    icon: CalendarCheck2,
    texto: "Horário confirmado",
    // Precisa ficar abaixo do selo "Agente de IA ativo" (fixo em
    // `sm:right-4 sm:top-4`, ver mais abaixo) — os dois disputavam o mesmo
    // canto superior direito e o texto saía sobreposto/cortado.
    className: "-right-4 top-[30%] sm:-right-9",
    atraso: "900ms",
    duracao: "7.2s",
    minWidth: "sm",
  },
  {
    icon: BellRing,
    texto: "Lembrete enviado",
    className: "-left-7 bottom-[16%]",
    atraso: "1900ms",
    duracao: "6.8s",
    minWidth: "lg",
  },
  {
    icon: RotateCcw,
    texto: "Retorno agendado",
    className: "-right-6 bottom-[8%] sm:-right-10",
    atraso: "1200ms",
    duracao: "7.6s",
    minWidth: "sm",
  },
];

export function HeroBookingActivity() {
  return (
    <>
      {/* Camada de trás: só os halos, atrás do painel. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 hidden sm:block">
        <div className="absolute -left-10 top-1/3 size-[220px] rounded-pill bg-night-glow/25 blur-[90px]" />
        <div className="absolute -right-6 bottom-1/4 size-[180px] rounded-pill bg-accent-lift/20 blur-[80px]" />
      </div>

      {/* Camada da frente: cartões, linhas e o selo do agente, por cima do
          painel — é o que dá a leitura de "flutuando ao redor da tela".
          Sem `hidden sm:block` aqui: cada filho decide sozinho em que largura
          aparece, porque o selo do agente precisa sobreviver no celular. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
        {/* Pontos-luz conectando os cartões ao painel — linhas finas, quase
            invisíveis, só sugerindo o fluxo. Só a partir do tablet: no
            celular não sobra cartão pra elas conectarem. */}
        <svg
          className="absolute inset-0 hidden size-full opacity-40 sm:block"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          fill="none"
        >
          <path
            d="M8 20 Q 25 26 38 34"
            stroke="var(--color-accent-lift)"
            strokeWidth="0.3"
            strokeDasharray="1 2.4"
          />
          <path
            d="M92 34 Q 78 32 64 30"
            stroke="var(--color-accent-lift)"
            strokeWidth="0.3"
            strokeDasharray="1 2.4"
          />
        </svg>

        {CARTOES.map((cartao) => (
          <span
            key={cartao.texto}
            className={cn(
              "absolute hidden items-center gap-1.5 rounded-control border border-night-line-strong bg-night-raised/90 px-2.5 py-1.5 text-meta text-night-ink-secondary shadow-lift backdrop-blur-sm",
              "flutuar",
              cartao.minWidth === "sm" && "sm:flex",
              cartao.minWidth === "lg" && "lg:flex",
              cartao.className,
            )}
            style={
              {
                "--atraso-flutuar": cartao.atraso,
                "--duracao-flutuar": cartao.duracao,
              } as React.CSSProperties
            }
          >
            <cartao.icon className="size-3.5 shrink-0 text-accent-lift" strokeWidth={2} />
            {cartao.texto}
          </span>
        ))}

        {/* O pulso do agente — único elemento que fica mesmo no celular,
            colado no canto do painel, porque é a peça que mais sozinha
            comunica "isto está ligado agora". */}
        <div className="absolute -bottom-3 left-1/2 flex -translate-x-1/2 sm:bottom-auto sm:left-auto sm:right-4 sm:top-4 sm:translate-x-0">
          <AnimatedStatusBadge label="Agente de IA ativo" tone="positive" />
        </div>
      </div>
    </>
  );
}
