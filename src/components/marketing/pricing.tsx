"use client";

import { useState } from "react";
import { formatBRL } from "@/lib/money";
import { formatMonths } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import type { PlanCta, PublicPlan } from "@/server/services/public-plans";
import { ArrowRight, CtaButton } from "./primitives";

/**
 * O cartão de preço.
 *
 * Tudo aqui vem do banco, gerenciado em Configurações > Planos do painel da
 * plataforma: nome, chamada, preços, benefícios, rótulo do botão e o link de
 * checkout. Preço escrito no código é preço que um dia diverge do que a fatura
 * cobra.
 *
 * Com UM plano, o cartão fica sozinho e centralizado. Dois cartões lado a lado
 * recriariam visualmente a comparação de faixas que o plano único acabou de
 * eliminar, e a primeira coisa que o visitante faria seria parar para comparar
 * em vez de assinar.
 */

type Props = {
  plans: Array<{ plan: PublicPlan; cta: { monthly: PlanCta; yearly: PlanCta } }>;
};

export function Pricing({ plans }: Props) {
  // Mensal por padrão: com o produto recém-lançado, o que falta é volume de
  // teste, não caixa antecipado de quem ainda não conhece o sistema.
  const [ciclo, setCiclo] = useState<"monthly" | "yearly">("monthly");

  if (plans.length === 0) {
    return (
      <p className="mx-auto max-w-[52ch] text-center text-lede text-night-ink-secondary">
        Os planos estão sendo atualizados.{" "}
        <a href="/entrar" className="text-accent-lift underline underline-offset-4">
          Fale com a gente
        </a>{" "}
        que passamos o preço na hora.
      </p>
    );
  }

  const temAnual = plans.some((p) => p.plan.yearlyPriceCents > 0);
  const economia = plans[0].plan.annual;

  return (
    <div>
      {temAnual ? (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <span
            className={cn(
              "text-label transition-colors",
              ciclo === "monthly" ? "font-semibold text-night-ink" : "text-night-ink-tertiary",
            )}
          >
            Mensal
          </span>

          <button
            type="button"
            role="switch"
            aria-checked={ciclo === "yearly"}
            aria-label="Cobrar por ano"
            onClick={() => setCiclo((c) => (c === "yearly" ? "monthly" : "yearly"))}
            className={cn(
              "relative h-6 w-11 rounded-pill transition-colors duration-200",
              ciclo === "yearly" ? "bg-accent" : "bg-night-raised",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "absolute top-0.5 size-5 rounded-pill bg-white transition-[left] duration-200",
                ciclo === "yearly" ? "left-[22px]" : "left-0.5",
              )}
            />
          </button>

          <span
            className={cn(
              "flex items-center gap-2 text-label transition-colors",
              ciclo === "yearly" ? "font-semibold text-night-ink" : "text-night-ink-tertiary",
            )}
          >
            Anual
            {economia.months >= 0.5 ? (
              <span className="rounded-pill bg-positive/20 px-2 py-0.5 text-meta font-bold uppercase tracking-[0.08em] text-[#5fd6ac]">
                {formatMonths(economia.months)} grátis
              </span>
            ) : null}
          </span>
        </div>
      ) : null}

      <div
        className={cn(
          "mt-9 grid gap-5",
          plans.length === 1 ? "mx-auto max-w-[520px]" : "md:grid-cols-3",
        )}
      >
        {plans.map(({ plan, cta }) => {
          const acao = ciclo === "yearly" ? cta.yearly : cta.monthly;
          const anual = ciclo === "yearly";
          const valorPrincipal = anual ? plan.annual.equivalentMonthlyCents : plan.monthlyPriceCents;

          return (
            <article
              key={plan.slug}
              className="relative flex flex-col rounded-overlay border border-night-line-strong bg-night-raised p-7 shadow-lift"
            >
              {plan.highlight && plan.highlightLabel ? (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-pill bg-accent px-3 py-1 text-meta font-bold text-white">
                  {plan.highlightLabel}
                </span>
              ) : null}

              <h3 className="text-quote text-night-ink">{plan.name}</h3>
              {plan.tagline ? (
                <p className="mt-1 text-body text-night-ink-secondary">{plan.tagline}</p>
              ) : null}

              <p className="mt-6 flex items-baseline gap-1.5">
                <span className="tabular text-stat text-night-ink">{formatBRL(valorPrincipal)}</span>
                <span className="text-body text-night-ink-secondary">por mês</span>
              </p>

              {/* O que a pessoa realmente paga precisa aparecer, não só o valor
                  mensal equivalente. Esconder isso é o truque que faz a fatura
                  chegar diferente do esperado. */}
              <p className="mt-1.5 text-caption text-night-ink-tertiary">
                {anual
                  ? `Cobrado ${formatBRL(plan.yearlyPriceCents)} uma vez por ano.`
                  : "Cobrado todo mês. Cancele quando quiser."}
              </p>

              {plan.benefits.length > 0 ? (
                <ul className="mt-6 space-y-2.5 border-t border-night-line pt-6">
                  {plan.benefits.map((beneficio) => (
                    <li key={beneficio} className="flex gap-2.5">
                      <svg
                        aria-hidden
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={3}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="mt-1 size-3.5 shrink-0 text-accent-lift"
                      >
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                      <span className="text-body text-night-ink-secondary">{beneficio}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-7 pt-1">
                <CtaButton
                  href={acao.href}
                  external={acao.kind === "checkout"}
                  className="w-full"
                >
                  {acao.label}
                  <ArrowRight />
                </CtaButton>

                <p className="mt-3 text-center text-caption text-night-ink-tertiary">
                  {acao.kind === "trial"
                    ? `${plan.trialDays} dias de teste. Sem cartão de crédito.`
                    : acao.kind === "checkout"
                      ? "Pagamento seguro. Cancele quando quiser."
                      : "A gente responde no mesmo dia."}
                </p>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
