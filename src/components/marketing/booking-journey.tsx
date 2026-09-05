"use client";

import { BookOpen, Calendar, Check } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { AnimatedStatusBadge } from "./animated-status-badge";
import { RetentionTimeline } from "./retention-timeline";

/**
 * A jornada animada: da primeira mensagem no WhatsApp ao convite de retorno.
 *
 * ONZE PASSOS (`step` 0–10), ~1,3s cada — o texto do `SectionHead` acima já
 * conta essa história em prosa, então tudo aqui é `aria-hidden`: é ilustração
 * do parágrafo, não conteúdo novo. Motor do loop:
 *
 * - Só avança com o painel visível na tela (`IntersectionObserver`, mesmo
 *   limiar do `Reveal`) e com a aba em primeiro plano (`visibilitychange`).
 * - Sob `prefers-reduced-motion`, o timer nem liga: a cena nasce direto no
 *   último passo, com a história inteira já montada — nenhuma informação fica
 *   escondida atrás de movimento.
 * - Os balões se ACUMULAM (não trocam um pelo outro) até o fim do ciclo, como
 *   uma conversa de verdade lida de cima para baixo; só os indicadores
 *   transitórios (digitando, consultando) somem quando deixam de fazer
 *   sentido.
 * - O contêiner reserva a altura do estado CHEIO desde o primeiro frame — a
 *   cena cresce por dentro dela, nunca empurra o que vem depois na página.
 */

const HORARIOS = ["10:00", "14:30", "17:00"] as const;
const ESCOLHIDO = "14:30";

const PASSO_CONFIRMADO = 6;
const PASSO_RETENCAO_INICIO = 7;
const PASSO_MENSAGEM_RETORNO = 9;
const ULTIMO_PASSO = 10;
const DURACAO_PASSO_MS = 1300;
const PAUSA_FINAL_MS = 2400;

/**
 * `useSyncExternalStore` em vez de `useState` + `useEffect`: matchMedia é um
 * armazém externo de verdade (pode mudar por fora do React, a qualquer
 * momento), e é exatamente o caso que esse hook resolve sem cair no
 * anti-padrão de chamar `setState` direto no corpo de um efeito.
 * `getServerSnapshot` devolve `false` — no servidor não existe `window`, e
 * "com movimento" é o padrão seguro até o cliente confirmar o contrário.
 */
function subscribeReducedMotion(callback: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}
function snapshotReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
function serverSnapshotReducedMotion() {
  return false;
}
function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, snapshotReducedMotion, serverSnapshotReducedMotion);
}

export function AnimatedBookingJourney() {
  const reduzido = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [visivel, setVisivel] = useState(false);
  const [passoInterno, setStep] = useState(0);
  const [reiniciando, setReiniciando] = useState(false);

  // `reduzido` pode nascer `false` no primeiro paint do cliente (o hook só
  // confirma o valor de verdade um instante depois, pra bater com o servidor
  // — ver `useReducedMotion`) e só então virar `true`. Calcular o passo
  // EXIBIDO a partir de `reduzido` a cada render, em vez de gravar isso uma
  // vez só dentro do `useState`, garante que a correção chegue na tela assim
  // que `reduzido` assentar, mesmo que o timer já tivesse avançado um passo.
  const step = reduzido ? ULTIMO_PASSO : passoInterno;

  // Só roda enquanto a cena está na tela — igual ao `Reveal`, mas sem
  // desconectar: aqui o ponto é PAUSAR e voltar, não revelar uma vez só.
  useEffect(() => {
    const alvo = containerRef.current;
    if (!alvo) return;
    const obs = new IntersectionObserver(([entrada]) => setVisivel(entrada.isIntersecting), {
      threshold: 0.35,
    });
    obs.observe(alvo);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (reduzido) return; // a cena já nasceu no passo final, parada.

    let cancelado = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    function agendar() {
      if (cancelado) return;
      const podeAndar = visivel && !document.hidden;
      const espera = podeAndar
        ? step === ULTIMO_PASSO
          ? PAUSA_FINAL_MS
          : DURACAO_PASSO_MS
        : 400; // parado: só reconsulta de vez em quando, sem gastar CPU à toa.

      timeoutId = setTimeout(() => {
        if (cancelado || !podeAndar) {
          agendar();
          return;
        }
        if (step === ULTIMO_PASSO) {
          setReiniciando(true);
          setTimeout(() => {
            if (cancelado) return;
            setStep(0);
            setReiniciando(false);
          }, 420);
        } else {
          setStep((s) => s + 1);
        }
      }, espera);
    }

    agendar();
    return () => {
      cancelado = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [step, visivel, reduzido]);

  useEffect(() => {
    if (reduzido) return;
    const aoMudar = () => setVisivel((v) => v && !document.hidden);
    document.addEventListener("visibilitychange", aoMudar);
    return () => document.removeEventListener("visibilitychange", aoMudar);
  }, [reduzido]);

  const retencaoIndex = step >= PASSO_RETENCAO_INICIO ? Math.min(step - PASSO_RETENCAO_INICIO, 3) : -1;

  return (
    <div
      ref={containerRef}
      aria-hidden
      className="mx-auto mt-14 max-w-[560px] rounded-overlay border border-night-line-strong bg-night-raised p-6 shadow-lift sm:p-8"
    >
      <div
        className={cn(
          "transition-opacity duration-300",
          reiniciando ? "opacity-0" : "opacity-100",
        )}
      >
        {/* A conversa. Altura mínima reservada para o estado cheio — evita a
            cena "pular" de tamanho conforme os balões se acumulam. */}
        <div className="min-h-[168px] space-y-2.5">
          {step >= 0 ? (
            <Balao lado="entrada" className="mensagem-in">
              Oi! Tem horário para fazer unha em gel amanhã?
            </Balao>
          ) : null}

          {step === 1 ? (
            <div className="mensagem-in flex items-center gap-1.5 rounded-card rounded-bl-sm bg-night-sunken px-3.5 py-2.5">
              <span className="flex gap-1">
                <span className="size-1.5 animate-bounce rounded-pill bg-night-ink-tertiary [animation-delay:-0.3s]" />
                <span className="size-1.5 animate-bounce rounded-pill bg-night-ink-tertiary [animation-delay:-0.15s]" />
                <span className="size-1.5 animate-bounce rounded-pill bg-night-ink-tertiary" />
              </span>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="mensagem-in flex items-center gap-2 rounded-pill border border-night-line-strong bg-night-sunken px-3 py-1.5 text-meta text-night-ink-tertiary">
              <BookOpen className="size-3.5 text-accent-lift" strokeWidth={2} />
              <Calendar className="size-3.5 text-accent-lift" strokeWidth={2} />
              Consultando catálogo e agenda…
            </div>
          ) : null}

          {step >= 3 ? (
            <Balao lado="saida" className="mensagem-in">
              <span className="mb-2 block text-body">Tenho estes horários livres:</span>
              <div className="flex flex-wrap gap-1.5">
                {HORARIOS.map((h) => {
                  const escolhido = step >= 4 && h === ESCOLHIDO;
                  const desbotado = step >= 4 && h !== ESCOLHIDO;
                  return (
                    <span
                      key={h}
                      className={cn(
                        "rounded-pill border px-2.5 py-1 text-label tabular transition-all duration-300",
                        escolhido
                          ? "border-accent-lift bg-accent-lift text-night"
                          : "border-night-line-strong bg-night text-night-ink-secondary",
                        desbotado && "opacity-40",
                      )}
                    >
                      {h}
                      {escolhido ? <Check className="ml-1 inline size-3" strokeWidth={3} /> : null}
                    </span>
                  );
                })}
              </div>
            </Balao>
          ) : null}

          {step >= 5 ? (
            <div className="mensagem-in overflow-hidden rounded-card border border-night-line-strong bg-night-sunken">
              <div className="flex items-center gap-2 border-b border-night-line px-3.5 py-2 text-meta text-night-ink-tertiary">
                <Calendar className="size-3.5" strokeWidth={2} />
                Agenda de amanhã
              </div>
              <ul className="divide-y divide-night-line">
                {HORARIOS.map((h) => {
                  const preenchido = h === ESCOLHIDO;
                  return (
                    <li
                      key={h}
                      className="flex items-center gap-3 px-3.5 py-2 text-caption"
                    >
                      <span className="w-12 shrink-0 tabular text-night-ink-tertiary">{h}</span>
                      {preenchido ? (
                        <span className="preenche-in flex min-w-0 flex-1 items-center justify-between gap-2 rounded-control bg-accent-lift/12 px-2.5 py-1">
                          <span className="min-w-0 truncate text-night-ink">
                            Ana · Unhas em Gel
                          </span>
                          <AnimatedStatusBadge label="Confirmado" tone="positive" pulse={false} />
                        </span>
                      ) : (
                        <span className="flex-1 text-night-ink-tertiary/60">Livre</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {step >= PASSO_CONFIRMADO ? (
            <Balao lado="saida" className="mensagem-in flex items-center gap-2">
              <Check className="size-4 shrink-0 text-[#5fd6ac]" strokeWidth={3} />
              Agendamento confirmado para amanhã, 14:30.
            </Balao>
          ) : null}

          {step >= PASSO_MENSAGEM_RETORNO ? (
            <Balao lado="saida" className="mensagem-in">
              Está chegando a hora da manutenção. Deseja agendar novamente?
            </Balao>
          ) : null}
        </div>

        {/* A linha de retorno — só aparece quando a história chega nela. */}
        <div
          className={cn(
            "grid transition-[grid-template-rows,opacity,margin-top] duration-500",
            retencaoIndex >= 0 ? "mt-7 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="overflow-hidden">
            <RetentionTimeline activeIndex={retencaoIndex} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Balao({
  lado,
  className,
  children,
}: {
  lado: "entrada" | "saida";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex", lado === "entrada" ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[85%] rounded-card px-3.5 py-2.5 text-body leading-relaxed",
          lado === "entrada"
            ? "rounded-bl-sm bg-night-sunken text-night-ink-secondary"
            : "rounded-br-sm bg-accent-lift/12 text-night-ink",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
