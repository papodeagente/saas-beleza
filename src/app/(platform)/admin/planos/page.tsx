import { sql } from "drizzle-orm";
import { Layers, Lock } from "lucide-react";
import { PlatformBody, PlatformHeader } from "@/components/platform-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { db } from "@/db";
import { subscriptionEvents, subscriptions } from "@/db/schema";
import { formatBRL } from "@/lib/money";
import { annualDeal, formatMonths, formatPercent } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { requirePlatformAdmin } from "@/server/platform-auth";
import { listPlans } from "@/server/services/platform-accounts";
import { NewPlanButton, type PlanRecord, PlanRowActions } from "./plan-form";

export const metadata = { title: "Planos" };
export const dynamic = "force-dynamic";

/**
 * Catálogo de planos.
 *
 * A tabela de preços é o que se VENDE; o que se COBRA está travado em
 * `subscriptions.price_cents` desde a contratação. As duas coisas convivem de
 * propósito, e a tela precisa dizer isso em voz alta — senão alguém reajusta um
 * plano achando que reajustou a base.
 */

/** Mesma normalização de MRR do resto do painel: anual conta como 1/12 por mês. */
const MRR_CASE = sql<number>`
  case when ${subscriptions.cycle} = 'yearly'
    then round(${subscriptions.priceCents}::numeric / 12)::int
    else ${subscriptions.priceCents}
  end
`;

type Usage = { accounts: number; paying: number; trialing: number; mrrCents: number };

const EMPTY_USAGE: Usage = { accounts: 0, paying: 0, trialing: 0, mrrCents: 0 };

export default async function PlanosPage() {
  await requirePlatformAdmin();

  const [planRows, usageRows, historyRows] = await Promise.all([
    listPlans(),
    db
      .select({
        planId: subscriptions.planId,
        accounts: sql<number>`count(*)::int`,
        paying: sql<number>`count(*) filter (where ${subscriptions.status} in ('active','past_due'))::int`,
        trialing: sql<number>`count(*) filter (where ${subscriptions.status} = 'trialing')::int`,
        mrrCents: sql<number>`coalesce(sum(case when ${subscriptions.status} in ('active','past_due') then ${MRR_CASE} else 0 end), 0)::int`,
      })
      .from(subscriptions)
      .groupBy(subscriptions.planId),
    // Plano citado em evento de assinatura já entrou na contabilidade: mesmo sem
    // assinatura viva, o registro não pode sumir.
    db.execute<{ plan_id: number }>(sql`
      select distinct plan_id from (
        select ${subscriptionEvents.planIdBefore} as plan_id from ${subscriptionEvents}
        union all
        select ${subscriptionEvents.planIdAfter} from ${subscriptionEvents}
      ) t
      where plan_id is not null
    `),
  ]);

  const usageByPlan = new Map<number, Usage>(
    usageRows.map((row) => [
      row.planId,
      {
        accounts: Number(row.accounts),
        paying: Number(row.paying),
        trialing: Number(row.trialing),
        mrrCents: Number(row.mrrCents),
      },
    ]),
  );

  const inHistory = new Set<number>(
    (historyRows.rows as Array<{ plan_id: number | string }>).map((row) => Number(row.plan_id)),
  );

  const ativos = planRows.filter((p) => p.active).length;
  const mrrTotal = planRows.reduce(
    (sum, plan) => sum + (usageByPlan.get(plan.id)?.mrrCents ?? 0),
    0,
  );

  return (
    <div>
      <PlatformHeader
        title="Planos"
        description={
          planRows.length === 0
            ? "Nenhum plano cadastrado"
            : `${planRows.length} ${planRows.length === 1 ? "plano" : "planos"} · ${ativos} à venda · ${formatBRL(mrrTotal)} de MRR`
        }
        actions={<NewPlanButton />}
      />

      <PlatformBody className="space-y-4">
        {/* O aviso que evita o erro caro: reajustar a tabela ≠ reajustar a base. */}
        <p className="flex items-start gap-2 text-caption text-ink-secondary">
          <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ink-tertiary" />
          Mudar o preço de um plano vale só para novas contratações: quem já assinou mantém o valor
          travado na assinatura.
        </p>

        {planRows.length === 0 ? (
          <Card>
            <EmptyState
              icon={Layers}
              title="A tabela de preços começa aqui"
              description="Crie o primeiro plano com preço mensal, preço anual e os limites que ele libera. Nada é cobrado por esta tela — ela define o que pode ser vendido."
              action={<NewPlanButton />}
            />
          </Card>
        ) : (
          <ul className="space-y-3">
            {planRows.map((plan) => {
              const usage = usageByPlan.get(plan.id) ?? EMPTY_USAGE;
              const deal = annualDeal(plan.monthlyPriceCents, plan.yearlyPriceCents);
              const record: PlanRecord = {
                id: plan.id,
                name: plan.name,
                slug: plan.slug,
                description: plan.description,
                monthlyPriceCents: plan.monthlyPriceCents,
                yearlyPriceCents: plan.yearlyPriceCents,
                trialDays: plan.trialDays,
                maxBranches: plan.maxBranches,
                maxProfessionals: plan.maxProfessionals,
                maxUsers: plan.maxUsers,
                position: plan.position,
                active: plan.active,
                publicVisible: plan.publicVisible,
                tagline: plan.tagline,
                benefits: Array.isArray(plan.features) ? plan.features : [],
                ctaLabel: plan.ctaLabel,
                checkoutUrlMonthly: plan.checkoutUrlMonthly,
                checkoutUrlYearly: plan.checkoutUrlYearly,
                highlight: plan.highlight,
                highlightLabel: plan.highlightLabel,
              };

              return (
                <li key={plan.id}>
                  <Card className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-card text-ink">{plan.name}</h2>
                          <Badge tone={plan.active ? "positive" : "neutral"}>
                            {plan.active ? "À venda" : "Fora de venda"}
                          </Badge>
                          <Badge tone={plan.publicVisible ? "accent" : "neutral"}>
                            {plan.publicVisible ? "No site" : "Fora do site"}
                          </Badge>
                          {plan.highlight ? (
                            <Badge tone="info">{plan.highlightLabel ?? "Em destaque"}</Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-caption text-ink-secondary">
                          <span className="text-ink-tertiary">{plan.slug}</span>
                          {plan.description ? ` · ${plan.description}` : ""}
                        </p>
                      </div>
                      <PlanRowActions
                        plan={record}
                        deletable={usage.accounts === 0 && !inHistory.has(plan.id)}
                      />
                    </div>

                    <div className="mt-4 grid gap-x-6 gap-y-4 border-t border-line pt-4 sm:grid-cols-2 lg:grid-cols-5">
                      <div>
                        <p className="text-section">Mensal</p>
                        <p className="mt-1 tabular text-entity text-ink">
                          {formatBRL(plan.monthlyPriceCents)}
                        </p>
                        <p className="mt-0.5 text-meta text-ink-secondary">por mês</p>
                      </div>

                      <div>
                        <p className="text-section">Anual</p>
                        <p className="mt-1 tabular text-entity text-ink">
                          {formatBRL(plan.yearlyPriceCents)}
                        </p>
                        <p className="mt-0.5 text-meta text-ink-secondary">
                          {formatBRL(deal.equivalentMonthlyCents)} por mês
                          {deal.savedCents > 0 ? (
                            <>
                              {" · "}
                              <span className="text-positive">
                                {formatPercent(deal.ratio)} de desconto
                              </span>
                            </>
                          ) : deal.savedCents < 0 ? (
                            <>
                              {" · "}
                              <span className="text-attention">mais caro que o mensal</span>
                            </>
                          ) : (
                            " · sem desconto"
                          )}
                        </p>
                        {deal.savedCents > 0 ? (
                          <p className="mt-1">
                            <Badge tone="accent">{formatMonths(deal.months)} de graça</Badge>
                          </p>
                        ) : null}
                      </div>

                      <div>
                        <p className="text-section">Teste</p>
                        <p className="mt-1 tabular text-entity text-ink">
                          {plan.trialDays === 0 ? "—" : plan.trialDays}
                        </p>
                        <p className="mt-0.5 text-meta text-ink-secondary">
                          {plan.trialDays === 0
                            ? "sem período de teste"
                            : plan.trialDays === 1
                              ? "dia grátis"
                              : "dias grátis"}
                        </p>
                      </div>

                      <div>
                        <p className="text-section">Limites</p>
                        <div className="mt-1.5 space-y-1">
                          <Limite rotulo="Unidades" valor={plan.maxBranches} />
                          <Limite rotulo="Profissionais" valor={plan.maxProfessionals} />
                          <Limite rotulo="Usuários" valor={plan.maxUsers} />
                        </div>
                      </div>

                      <div>
                        <p className="text-section">Receita do plano</p>
                        <p
                          className={cn(
                            "mt-1 tabular text-entity",
                            usage.mrrCents > 0 ? "text-ink" : "text-ink-tertiary",
                          )}
                        >
                          {formatBRL(usage.mrrCents)}
                        </p>
                        <p className="mt-0.5 text-meta text-ink-secondary">
                          {usage.accounts === 0
                            ? "nenhuma conta usa este plano"
                            : `${usage.accounts} ${usage.accounts === 1 ? "conta" : "contas"} · ${usage.paying} pagante${usage.paying === 1 ? "" : "s"}${usage.trialing > 0 ? ` · ${usage.trialing} em teste` : ""}`}
                        </p>
                      </div>
                    </div>

                    <Vitrine plan={plan} />
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </PlatformBody>
    </div>
  );
}

/**
 * Estado da vitrine de um plano.
 *
 * Existe por causa de uma pergunta que ninguém responde olhando a tabela de
 * preços: "esse botão no site VENDE hoje?". Sem link de checkout ele não vende —
 * ele inscreve no teste grátis, o que é uma decisão legítima e completamente
 * diferente. Dizer isso por extenso é o que impede alguém de anunciar o preço
 * achando que o dinheiro entra sozinho.
 */
function Vitrine({ plan }: { plan: Awaited<ReturnType<typeof listPlans>>[number] }) {
  const beneficios = Array.isArray(plan.features) ? plan.features.length : 0;

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-section">Vitrine</p>
        <p className="text-caption text-ink-secondary">
          {plan.publicVisible
            ? plan.active
              ? "Aparece na página de preços do site."
              : "Marcado para o site, mas fora de venda — não aparece enquanto estiver desativado."
            : "Não aparece no site. Vendável só pelo painel."}
        </p>
      </div>

      <p className="mt-1 text-caption text-ink-secondary">
        {plan.tagline ? (
          <span className="text-ink">“{plan.tagline}”</span>
        ) : (
          <span className="text-ink-tertiary">Sem chamada curta</span>
        )}
        {" · "}
        <span className={beneficios === 0 ? "text-ink-tertiary" : undefined}>
          {beneficios === 0
            ? "nenhum benefício listado"
            : `${beneficios} ${beneficios === 1 ? "benefício" : "benefícios"}`}
        </span>
      </p>

      <div className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <Checkout ciclo="Mensal" url={plan.checkoutUrlMonthly} trialDays={plan.trialDays} />
        <Checkout ciclo="Anual" url={plan.checkoutUrlYearly} trialDays={plan.trialDays} />
      </div>
    </div>
  );
}

/** A mesma decisão que `planCta` toma no site, dita em português para quem opera. */
function Checkout({
  ciclo,
  url,
  trialDays,
}: {
  ciclo: string;
  url: string | null;
  trialDays: number;
}) {
  const colado = Boolean(url);
  return (
    <p className="flex items-baseline gap-1.5 text-caption">
      <span className="shrink-0 text-ink-secondary">{ciclo}:</span>
      <span className={colado ? "text-positive" : "text-ink-tertiary"}>
        {colado
          ? "Link colado"
          : trialDays > 0
            ? "Sem checkout — o botão do site leva ao teste grátis"
            : "Sem checkout e sem teste — o botão do site só leva ao contato"}
      </span>
    </p>
  );
}

/** `null` no banco significa sem teto — dizer "0" seria o oposto do que é. */
function Limite({ rotulo, valor }: { rotulo: string; valor: number | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-caption text-ink-secondary">{rotulo}</span>
      <span
        className={cn("tabular text-caption", valor === null ? "text-ink-tertiary" : "text-ink")}
      >
        {valor === null ? "Ilimitado" : valor}
      </span>
    </div>
  );
}
