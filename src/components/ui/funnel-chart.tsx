"use client";

import { useState } from "react";
import { ArrowDown, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FunnelStageMetric } from "@/server/services/booking-funnel-service";

/**
 * Os seis degraus moram em globals.css (`--funnel-step-*`). Aqui ficavam seis
 * hexadecimais cravados: cor que não está no tema é cor que ninguém acha
 * quando a marca muda, e este é o único gráfico do produto com paleta própria.
 *
 * A ponta esquerda da barra ESCURECE em vez de desbotar. O gradiente antigo
 * (`${cor}dd`) misturava a barra com o fundo claro e custava contraste ao
 * rótulo branco justamente na borda onde ele começa; misturar com o ink dá o
 * mesmo volume e sobe o contraste em vez de derrubá-lo.
 */
const DEGRAUS = [
  "var(--funnel-step-1)",
  "var(--funnel-step-2)",
  "var(--funnel-step-3)",
  "var(--funnel-step-4)",
  "var(--funnel-step-5)",
  "var(--funnel-step-6)",
];

export function FunnelChart({ stages }: { stages: FunnelStageMetric[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...stages.map((stage) => stage.value), 1);
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(310px,.65fr)]">
      <div className="relative flex min-h-[420px] flex-col justify-center overflow-hidden rounded-overlay border border-line bg-[radial-gradient(circle_at_50%_0%,color-mix(in_srgb,var(--funnel-step-1)_13%,transparent),transparent_58%),var(--color-surface-sunken)] px-4 py-8 sm:px-8">
        <div aria-hidden className="absolute inset-0 opacity-30 [background-image:linear-gradient(var(--color-line)_1px,transparent_1px),linear-gradient(90deg,var(--color-line)_1px,transparent_1px)] [background-size:32px_32px]" />
        <div className="relative mx-auto flex w-full max-w-[760px] flex-col items-center gap-1.5">
          {stages.map((stage, index) => {
            const rawWidth = stage.value > 0 ? (stage.value / max) * 100 : 10;
            const width = Math.max(16, Math.min(100, rawWidth));
            const selected = active === index;
            return (
              <button
                key={stage.key}
                type="button"
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
                className={cn("group relative h-14 transition-all duration-200 focus:outline-none", selected ? "z-10 scale-[1.025]" : active !== null ? "opacity-55" : "opacity-100")}
                style={{ width: `${width}%`, minWidth: "180px" }}
                aria-label={`${stage.label}: ${stage.value}`}
              >
                <span className="absolute inset-0 shadow-[0_8px_24px_rgba(78,34,119,.16)] [clip-path:polygon(4%_0,96%_0,90%_100%,10%_100%)]" style={{ background: `linear-gradient(90deg,color-mix(in srgb,var(--color-ink) 16%,${DEGRAUS[index]}),${DEGRAUS[index]})` }} />
                <span className="relative flex h-full items-center justify-center gap-2 px-6 text-white">
                  <span className="truncate text-label font-semibold">{stage.label}</span>
                  <strong className="text-title tabular">{stage.value.toLocaleString("pt-BR")}</strong>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <ol className="space-y-2">
        {stages.map((stage, index) => (
          <li key={stage.key} className="relative">
            {index > 0 ? <ArrowDown className="absolute -top-3 left-5 z-10 size-4 rounded-full bg-surface-raised p-0.5 text-ink-tertiary" aria-hidden /> : null}
            <button type="button" onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)} className={cn("flex w-full items-center gap-3 rounded-card border bg-surface-raised px-4 py-3 text-left shadow-card transition-colors", active === index ? "border-accent/45" : "border-line")}>
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: DEGRAUS[index] }} />
              <span className="min-w-0 flex-1"><span className="block text-label text-ink">{stage.label}</span>{index > 0 ? <span className="mt-0.5 flex items-center gap-1 text-caption text-ink-secondary"><TrendingDown className="size-3" aria-hidden />{stage.conversion.toFixed(1).replace(".", ",")}% da etapa anterior</span> : <span className="text-caption text-ink-secondary">Base do período</span>}</span>
              <strong className="text-title tabular text-ink">{stage.value.toLocaleString("pt-BR")}</strong>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
