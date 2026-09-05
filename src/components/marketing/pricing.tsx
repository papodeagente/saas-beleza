"use client";

import { useState } from "react";
import { formatBRL } from "@/lib/money";
import { type AnnualDeal, formatMonths } from "@/lib/pricing";
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
 * Com UM plano, as três colunas são os três CICLOS de cobrança do mesmo
 * plano lado a lado — não três planos diferentes. É a mesma decisão de
 * sempre (nada de comparação de faixa escondendo o preço real), só que a
 * pessoa vê de cara o que ganha pagando adiantado, sem precisar clicar num
 * interruptor para descobrir.
 *
 * Com MAIS de um plano — o produto ainda não vende assim, mas o código
 * continua pronto para o dia em que vender — a comparação volta a ser por
 * PLANO, com um interruptor de ciclo em cima, porque nove cartões (3 planos ×
 * 3 ciclos) de uma vez é ruído, não vitrine.
 */

type CycleKey = "monthly" | "quarterly" | "yearly";

const CYCLE_LABEL: Record<CycleKey, string> = { monthly: "Mensal", quarterly: "Trimestral", yearly: "Anual" };
const PERIOD_LABEL: Record<CycleKey, string> = { monthly: "por mês", quarterly: "por trimestre", yearly: "por ano" };

/**
 * TEMPORÁRIO — promoção de lançamento das 30 primeiras clientes.
 *
 * O checkout da Hubla cobra R$97 na adesão (primeiro pagamento, todo ciclo) e
 * depois um valor promocional no mensal e no trimestral, válido só para as 30
 * primeiras clientes; passado isso, a cobrança recorrente volta ao preço de
 * tabela (o mesmo que já vem do banco em `plan.monthlyPriceCents` /
 * `quarterlyPriceCents`). O anual não tem promoção.
 *
 * Remover a menção à promoção (e voltar para o texto fixo "Cobrado todo mês
 * feito o mesmo lá, um por mês/trimestre.") quando a 31ª cliente assinar —
 * não há como o site saber isso sozinho, é o Bruno quem avisa.
 */
const BILLED_LABEL: Record<CycleKey, (plan: PublicPlan) => string> = {
  monthly: () =>
    "R$97 na adesão, depois R$59,90/mês — promoção para as 30 primeiras clientes. Depois volta a R$97/mês.",
  quarterly: () =>
    "R$97 na adesão, depois R$179,00 a cada 3 meses — promoção para as 30 primeiras clientes. Depois volta a R$242/trimestre.",
  yearly: (plan) => `R$97 na adesão, depois ${formatBRL(plan.yearlyPriceCents)} uma vez por ano.`,
};

type Props = {
  plans: Array<{ plan: PublicPlan; cta: { monthly: PlanCta; quarterly: PlanCta; yearly: PlanCta } }>;
};

export function Pricing({ plans }: Props) {
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

  if (plans.length === 1) {
    return <CycleColumns plan={plans[0].plan} cta={plans[0].cta} />;
  }

  return <TierToggle plans={plans} />;
}

/** Melhor economia entre os ciclos maiores — decide o selo "mais escolhido" da coluna anual. */
function melhorNegocio(plan: PublicPlan): CycleKey {
  return plan.annual.months >= plan.quarterly.months ? "yearly" : "quarterly";
}

/**
 * As três colunas de um plano só — a forma que a página assume hoje, com um
 * plano público.
 */
function CycleColumns({
  plan,
  cta,
}: {
  plan: PublicPlan;
  cta: { monthly: PlanCta; quarterly: PlanCta; yearly: PlanCta };
}) {
  const destaque = melhorNegocio(plan);
  const deals: Record<CycleKey, AnnualDeal | null> = {
    monthly: null,
    quarterly: plan.quarterly,
    yearly: plan.annual,
  };
  const prices: Record<CycleKey, number> = {
    monthly: plan.monthlyPriceCents,
    quarterly: plan.quarterlyPriceCents,
    yearly: plan.yearlyPriceCents,
  };
  const ctas: Record<CycleKey, PlanCta> = cta;
  const cycles: CycleKey[] = ["monthly", "quarterly", "yearly"];

  return (
    <div className="grid gap-5 md:grid-cols-3">
      {cycles.map((cycleKey) => {
        const deal = deals[cycleKey];
        const emDestaque = cycleKey === destaque && Boolean(deal && deal.savedCents > 0);

        return (
          <article
            key={cycleKey}
            className={cn(
              "relative flex flex-col rounded-overlay border p-7 shadow-lift transition-[transform,border-color] duration-200 ease-out-quint hover:-translate-y-1",
              emDestaque
                ? "border-accent-lift/60 bg-night-raised hover:border-accent-lift"
                : "border-night-line-strong bg-night-raised hover:border-night-ink-tertiary",
            )}
          >
            {emDestaque ? (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-pill bg-accent px-3 py-1 text-meta font-bold text-white">
                Melhor economia
              </span>
            ) : null}

            <h3 className="text-quote text-night-ink">{CYCLE_LABEL[cycleKey]}</h3>
            <p className="mt-1 text-body text-night-ink-secondary">
              {plan.name}
              {plan.tagline ? ` — ${plan.tagline}` : ""}
            </p>

            <p className="mt-6 flex items-baseline gap-1.5">
              <span className="tabular text-stat text-night-ink">{formatBRL(prices[cycleKey])}</span>
              <span className="text-body text-night-ink-secondary">{PERIOD_LABEL[cycleKey]}</span>
            </p>

            <p className="mt-1.5 text-caption text-night-ink-tertiary">{BILLED_LABEL[cycleKey](plan)}</p>

            {deal && deal.savedCents > 0 ? (
              <p className="mt-2">
                <span className="rounded-pill bg-positive/20 px-2 py-0.5 text-meta font-bold uppercase tracking-[0.08em] text-[#5fd6ac]">
                  {formatMonths(deal.months)} grátis
                </span>
              </p>
            ) : null}

            {plan.benefits.length > 0 ? (
              <ul className="mt-6 space-y-2.5 border-t border-night-line pt-6">
                {plan.benefits.map((beneficio) => (
                  <li key={beneficio} className="flex gap-2.5">
                    <Check />
                    <span className="text-body text-night-ink-secondary">{beneficio}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-7 pt-1">
              <CtaButton href={ctas[cycleKey].href} external={ctas[cycleKey].kind === "checkout"} className="w-full">
                {ctas[cycleKey].label}
                <ArrowRight />
              </CtaButton>

              <p className="mt-3 text-center text-caption text-night-ink-tertiary">
                {ctas[cycleKey].kind === "trial"
                  ? `${plan.trialDays} dias de teste. Sem cartão de crédito.`
                  : ctas[cycleKey].kind === "checkout"
                    ? "Pagamento seguro. Cancele quando quiser."
                    : "A gente responde no mesmo dia."}
              </p>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function Check() {
  return (
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
  );
}

/**
 * Comparação por PLANO, com o ciclo escolhido por um interruptor em cima —
 * o layout de quando existir mais de um plano público ao mesmo tempo.
 */
function TierToggle({ plans }: Props) {
  const [ciclo, setCiclo] = useState<CycleKey>("monthly");

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

      <div className="mt-9 grid gap-5 md:grid-cols-3">
        {plans.map(({ plan, cta }) => {
          const acao = ciclo === "yearly" ? cta.yearly : ciclo === "quarterly" ? cta.quarterly : cta.monthly;
          const valorPrincipal =
            ciclo === "yearly"
              ? plan.annual.equivalentMonthlyCents
              : ciclo === "quarterly"
                ? plan.quarterly.equivalentMonthlyCents
                : plan.monthlyPriceCents;

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

              <p className="mt-1.5 text-caption text-night-ink-tertiary">{BILLED_LABEL[ciclo](plan)}</p>

              {plan.benefits.length > 0 ? (
                <ul className="mt-6 space-y-2.5 border-t border-night-line pt-6">
                  {plan.benefits.map((beneficio) => (
                    <li key={beneficio} className="flex gap-2.5">
                      <Check />
                      <span className="text-body text-night-ink-secondary">{beneficio}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-7 pt-1">
                <CtaButton href={acao.href} external={acao.kind === "checkout"} className="w-full">
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
