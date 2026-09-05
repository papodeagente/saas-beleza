import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { plans } from "@/db/schema";
import { type AnnualDeal, annualDeal, quarterlyDeal } from "@/lib/pricing";

/**
 * Os planos como o site pode vê-los.
 *
 * Nenhuma função daqui recebe contexto, e isso é proposital: é o que impede
 * alguém de reaproveitar um serviço de tenant numa página pública por engano.
 * Em compensação, as colunas são escolhidas uma a uma — o `id` e os limites
 * internos (max_branches, max_users) não saem, porque id numérico em página
 * pública entrega contagem e crescimento de graça a quem quiser medir.
 *
 * Dois filtros, não um: `active` diz que o plano aceita nova assinatura,
 * `publicVisible` diz que ele aparece no site. Um preço negociado continua
 * vendável pelo painel sem nunca subir na página.
 */

export type PublicPlan = {
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  monthlyPriceCents: number;
  quarterlyPriceCents: number;
  yearlyPriceCents: number;
  annual: AnnualDeal;
  quarterly: AnnualDeal;
  trialDays: number;
  benefits: string[];
  highlight: boolean;
  highlightLabel: string | null;
  ctaLabel: string | null;
  checkout: { monthly: string | null; quarterly: string | null; yearly: string | null };
};

/**
 * Link de checkout só sai daqui se for https. O campo é digitado à mão no
 * painel, e um `javascript:` colado ali viraria execução de script no clique
 * do visitante.
 */
function safeCheckout(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function toPublic(row: typeof plans.$inferSelect): PublicPlan {
  return {
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    monthlyPriceCents: row.monthlyPriceCents,
    quarterlyPriceCents: row.quarterlyPriceCents,
    yearlyPriceCents: row.yearlyPriceCents,
    annual: annualDeal(row.monthlyPriceCents, row.yearlyPriceCents),
    quarterly: quarterlyDeal(row.monthlyPriceCents, row.quarterlyPriceCents),
    trialDays: row.trialDays,
    benefits: Array.isArray(row.features) ? row.features : [],
    highlight: row.highlight,
    highlightLabel: row.highlightLabel,
    ctaLabel: row.ctaLabel,
    checkout: {
      monthly: safeCheckout(row.checkoutUrlMonthly),
      quarterly: safeCheckout(row.checkoutUrlQuarterly),
      yearly: safeCheckout(row.checkoutUrlYearly),
    },
  };
}

export async function listPublicPlans(): Promise<PublicPlan[]> {
  const rows = await db
    .select()
    .from(plans)
    .where(and(eq(plans.active, true), eq(plans.publicVisible, true)))
    .orderBy(asc(plans.position), asc(plans.id));

  return rows.map(toPublic);
}

/**
 * Usado pelo autocadastro para resolver `?plano=slug`. Recusa plano fora da
 * vitrine: se o site não o oferece, ninguém contrata escrevendo o slug na URL.
 */
export async function getPublicPlanBySlug(slug: string): Promise<PublicPlan | null> {
  const [row] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.slug, slug), eq(plans.active, true), eq(plans.publicVisible, true)))
    .limit(1);

  return row ? toPublic(row) : null;
}

/**
 * O que o botão de um plano deve fazer, decidido PELO PLANO e não pelo provedor
 * de pagamento.
 *
 * É o que desacopla a página do meio de cobrança: a Hotmart pode ficar dormente
 * o tempo que for, e o site continua vendendo teste grátis em vez de exibir um
 * botão morto.
 */
export type PlanCta =
  | { kind: "checkout"; href: string; label: string }
  | { kind: "trial"; href: string; label: string }
  | { kind: "contact"; href: string; label: string };

export function planCta(plan: PublicPlan, cycle: "monthly" | "quarterly" | "yearly"): PlanCta {
  const checkout =
    cycle === "yearly" ? plan.checkout.yearly : cycle === "quarterly" ? plan.checkout.quarterly : plan.checkout.monthly;
  if (checkout) {
    return { kind: "checkout", href: checkout, label: plan.ctaLabel ?? "Assinar agora" };
  }
  if (plan.trialDays > 0) {
    return {
      kind: "trial",
      href: `/criar-conta?plano=${encodeURIComponent(plan.slug)}&ciclo=${cycle}`,
      label: plan.ctaLabel ?? `Começar o teste de ${plan.trialDays} dias`,
    };
  }
  return { kind: "contact", href: "/entrar", label: plan.ctaLabel ?? "Falar com a gente" };
}
