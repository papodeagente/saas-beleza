"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Acordeão de perguntas.
 *
 * A altura anima por `grid-template-rows: 0fr → 1fr` em vez de `max-height`
 * fixa. Com max-height, a primeira resposta longa em tela estreita passa do
 * limite e é cortada em silêncio, sem aviso nenhum de que faltou texto.
 */

export type Pergunta = { pergunta: string; resposta: React.ReactNode };

export function Faq({ itens }: { itens: Pergunta[] }) {
  const [aberta, setAberta] = useState<number | null>(0);
  const base = useId();

  return (
    <ul className="mx-auto max-w-[820px] divide-y divide-night-line border-y border-night-line">
      {itens.map((item, i) => {
        const estaAberta = aberta === i;
        return (
          <li key={item.pergunta}>
            <h3>
              <button
                type="button"
                aria-expanded={estaAberta}
                aria-controls={`${base}-${i}`}
                onClick={() => setAberta(estaAberta ? null : i)}
                className="flex w-full items-start justify-between gap-5 py-5 text-left"
              >
                <span className="text-card text-night-ink">{item.pergunta}</span>
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 shrink-0 text-night-ink-tertiary transition-transform duration-200",
                    estaAberta && "rotate-45",
                  )}
                >
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
              </button>
            </h3>

            <div
              id={`${base}-${i}`}
              className={cn(
                "grid transition-[grid-template-rows] duration-300 ease-out-quint",
                estaAberta ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
              )}
            >
              <div className="overflow-hidden">
                <div className="max-w-[68ch] pb-6 pr-8 text-body leading-relaxed text-night-ink-secondary">
                  {item.resposta}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
