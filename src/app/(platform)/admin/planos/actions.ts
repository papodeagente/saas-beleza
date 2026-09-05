"use server";

import { eq, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { plans, subscriptionEvents, subscriptions } from "@/db/schema";
import { parseBRL } from "@/lib/money";
import { requirePlatformAdmin } from "@/server/platform-auth";

/**
 * Catálogo de planos.
 *
 * NENHUMA operação daqui mexe em receita, e é por isso que nenhuma delas grava
 * `subscription_events`: o preço da assinatura é travado em
 * `subscriptions.price_cents` na contratação, então mudar a tabela de preços
 * não altera um centavo de MRR de quem já assinou. Ativar/desativar também é
 * regra de venda (aceita novas assinaturas ou não), nunca cobrança.
 *
 * O dia em que existir "reprecificar quem já assina", essa operação passa a ser
 * mutação de assinatura: escreve `upgraded`/`downgraded` com before/after na
 * MESMA transação, senão o movimento de MRR do painel passa a mentir.
 *
 * O que MUDA de natureza aqui é a vitrine: os campos de vitrine saem desta tela
 * direto para uma página pública. Deixaram de ser configuração interna e viraram
 * entrada não confiável — daí a validação de `checkoutUrl` ser tão dura quanto
 * seria a de um formulário aberto na internet.
 */

export type PlanResult =
  | { ok: true; planId: number }
  | { ok: false; error: string; field?: string };

/** O formulário manda tudo como texto — dinheiro em reais, limites em branco = ilimitado. */
const payloadSchema = z.object({
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  monthlyPrice: z.string(),
  quarterlyPrice: z.string(),
  yearlyPrice: z.string(),
  trialDays: z.string(),
  maxBranches: z.string(),
  maxProfessionals: z.string(),
  maxUsers: z.string(),
  position: z.string(),

  // Vitrine pública. Chega inteira a cada salvamento (inclusive a lista de
  // benefícios completa): o formulário não manda diferença, manda o estado final.
  publicVisible: z.boolean(),
  tagline: z.string(),
  benefits: z.array(z.string()),
  ctaLabel: z.string(),
  checkoutUrlMonthly: z.string(),
  checkoutUrlQuarterly: z.string(),
  checkoutUrlYearly: z.string(),
  highlight: z.boolean(),
  highlightLabel: z.string(),
});

export type PlanPayload = z.infer<typeof payloadSchema>;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type PlanValues = {
  slug: string;
  name: string;
  description: string | null;
  monthlyPriceCents: number;
  quarterlyPriceCents: number;
  yearlyPriceCents: number;
  trialDays: number;
  maxBranches: number | null;
  maxProfessionals: number | null;
  maxUsers: number | null;
  position: number;
  publicVisible: boolean;
  tagline: string | null;
  features: string[];
  ctaLabel: string | null;
  checkoutUrlMonthly: string | null;
  checkoutUrlQuarterly: string | null;
  checkoutUrlYearly: string | null;
  highlight: boolean;
  highlightLabel: string | null;
};

type Normalized = { ok: true; value: PlanValues } | { ok: false; error: string; field: string };

const invalid = (field: string, error: string): Normalized => ({ ok: false, error, field });

/**
 * Os normalizadores abaixo devolvem "valor OU erro", e o valor legítimo pode ser
 * `null` (campo em branco). `typeof x === "object"` sozinho classificaria esse
 * `null` como erro e recusaria todo campo opcional vazio.
 */
const isInvalid = (value: unknown): value is Normalized =>
  typeof value === "object" && value !== null;

/** Limite vazio significa ILIMITADO — não zero. Zero seria um plano que não serve para nada. */
function limit(raw: string, field: string, label: string): number | null | Normalized {
  const value = raw.trim();
  if (value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 100_000) {
    return invalid(field, `${label}: informe um número inteiro a partir de 1, ou deixe em branco para ilimitado.`);
  }
  return n;
}

/** Texto curto de vitrine: vazio vira null, para o site poder testar por ausência. */
function shortText(
  raw: string,
  field: string,
  label: string,
  max: number,
): string | null | Normalized {
  const value = raw.trim().replace(/\s+/g, " ");
  if (value === "") return null;
  if (value.length > max) {
    return invalid(field, `${label}: no máximo ${max} caracteres — este ficou com ${value.length}.`);
  }
  return value;
}

/** Mais que isto não é uma lista de benefícios, é um manual. */
const MAX_BENEFITS = 20;
const MAX_BENEFIT_LENGTH = 120;

/**
 * Benefícios: array de strings, sem item vazio e sem espaço sobrando.
 *
 * A limpeza acontece AQUI e não na tela porque o array é gravado como jsonb e
 * lido direto pelo site: um `""` no meio da lista viraria uma linha em branco no
 * cartão de preço, e ninguém descobriria olhando o painel.
 */
function benefits(raw: string[]): string[] | Normalized {
  const cleaned = raw.map((item) => item.trim().replace(/\s+/g, " ")).filter(Boolean);
  if (cleaned.length > MAX_BENEFITS) {
    return invalid("benefits", `A lista vai até ${MAX_BENEFITS} benefícios. Tire alguns dos menos importantes.`);
  }
  const longo = cleaned.find((item) => item.length > MAX_BENEFIT_LENGTH);
  if (longo) {
    return invalid(
      "benefits",
      `Cada benefício cabe em ${MAX_BENEFIT_LENGTH} caracteres. Encurte "${longo.slice(0, 40)}…".`,
    );
  }
  return cleaned;
}

const MAX_URL_LENGTH = 500;

/**
 * Link de checkout — o campo mais perigoso desta tela.
 *
 * Ele vira o `href` de um botão numa página pública, então `javascript:` colado
 * aqui é execução de script no navegador de quem visita o site, não um link
 * torto. `http:` é recusado junto: pagamento em texto claro, e navegador
 * moderno bloqueia conteúdo misto de qualquer jeito.
 *
 * Guarda o resultado de `URL.toString()`, não o texto digitado: `HTTPS://…` e
 * `https:/loja` são aceitos pelo parser mas não passam no CHECK do banco, que
 * compara `like 'https://%'` com maiúsculas e barras contando.
 */
function checkoutUrl(raw: string, field: string, label: string): string | null | Normalized {
  const value = raw.trim();
  if (value === "") return null;
  if (value.length > MAX_URL_LENGTH) {
    return invalid(field, `${label}: esse link é longo demais. Confira se colou só o endereço.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalid(
      field,
      `${label}: cole o endereço completo da página de pagamento, começando com https://.`,
    );
  }
  if (parsed.protocol !== "https:") {
    return invalid(
      field,
      `${label}: só aceitamos endereço que comece com https://. Confira o link copiado do provedor de pagamento.`,
    );
  }
  return parsed.toString();
}

function normalize(input: PlanPayload, creating: boolean): Normalized {
  const name = input.name.trim();
  if (name.length < 2) return invalid("name", "Dê um nome ao plano.");
  if (name.length > 60) return invalid("name", "O nome do plano ficou longo demais.");

  // O slug só é lido na criação: na edição ele é imutável (ver savePlanAction).
  const slug = input.slug.trim().toLowerCase();
  if (creating) {
    if (!slug) return invalid("slug", "Informe o identificador do plano.");
    if (!SLUG_RE.test(slug) || slug.length > 40) {
      return invalid("slug", "Use só letras minúsculas, números e hífen — por exemplo: profissional-plus.");
    }
  }

  const monthlyPriceCents = parseBRL(input.monthlyPrice);
  if (monthlyPriceCents === null) return invalid("monthlyPrice", "Informe o preço mensal em reais.");
  const quarterlyPriceCents = parseBRL(input.quarterlyPrice);
  if (quarterlyPriceCents === null) return invalid("quarterlyPrice", "Informe o preço trimestral em reais.");
  const yearlyPriceCents = parseBRL(input.yearlyPrice);
  if (yearlyPriceCents === null) return invalid("yearlyPrice", "Informe o preço anual em reais.");
  if (monthlyPriceCents > 5_000_000 || quarterlyPriceCents > 15_000_000 || yearlyPriceCents > 50_000_000) {
    return invalid("monthlyPrice", "Esse preço parece errado. Confira as casas decimais.");
  }

  const trialDays = Number(input.trialDays.trim());
  if (!Number.isInteger(trialDays) || trialDays < 0 || trialDays > 365) {
    return invalid("trialDays", "Dias de teste: um número inteiro entre 0 e 365.");
  }

  const position = input.position.trim() === "" ? 0 : Number(input.position.trim());
  if (!Number.isInteger(position) || position < 0 || position > 999) {
    return invalid("position", "Ordem: um número inteiro entre 0 e 999.");
  }

  const maxBranches = limit(input.maxBranches, "maxBranches", "Unidades");
  if (isInvalid(maxBranches)) return maxBranches;
  const maxProfessionals = limit(input.maxProfessionals, "maxProfessionals", "Profissionais");
  if (isInvalid(maxProfessionals)) return maxProfessionals;
  const maxUsers = limit(input.maxUsers, "maxUsers", "Usuários");
  if (isInvalid(maxUsers)) return maxUsers;

  const tagline = shortText(input.tagline, "tagline", "Chamada do site", 90);
  if (isInvalid(tagline)) return tagline;
  const ctaLabel = shortText(input.ctaLabel, "ctaLabel", "Rótulo do botão", 40);
  if (isInvalid(ctaLabel)) return ctaLabel;

  /**
   * O selo só é lido quando o destaque está ligado, e há duas razões para isso.
   *
   * A primeira é de dado: sem destaque o selo não tem onde aparecer, e guardar o
   * texto órfão faria o plano voltar destacado com um rótulo antigo no dia em
   * que alguém remarcasse a caixa.
   *
   * A segunda é o que quebrava de verdade: o formulário ESCONDE o campo do selo
   * quando o destaque está desligado. Validar assim mesmo devolvia um erro
   * apontando para um campo que não está na tela — a folha ficava aberta, sem
   * mensagem nenhuma em lugar nenhum, e quem opera só via o botão Salvar parar
   * de responder. Erro que não tem onde aparecer não pode ser emitido.
   */
  const highlightLabel = input.highlight
    ? shortText(input.highlightLabel, "highlightLabel", "Selo do destaque", 24)
    : null;
  if (isInvalid(highlightLabel)) return highlightLabel;

  const features = benefits(input.benefits);
  if (!Array.isArray(features)) return features;

  const checkoutUrlMonthly = checkoutUrl(
    input.checkoutUrlMonthly,
    "checkoutUrlMonthly",
    "Link de checkout mensal",
  );
  if (isInvalid(checkoutUrlMonthly)) return checkoutUrlMonthly;
  const checkoutUrlQuarterly = checkoutUrl(
    input.checkoutUrlQuarterly,
    "checkoutUrlQuarterly",
    "Link de checkout trimestral",
  );
  if (isInvalid(checkoutUrlQuarterly)) return checkoutUrlQuarterly;
  const checkoutUrlYearly = checkoutUrl(
    input.checkoutUrlYearly,
    "checkoutUrlYearly",
    "Link de checkout anual",
  );
  if (isInvalid(checkoutUrlYearly)) return checkoutUrlYearly;

  return {
    ok: true,
    value: {
      slug,
      name,
      description: input.description.trim() || null,
      monthlyPriceCents,
      quarterlyPriceCents,
      yearlyPriceCents,
      trialDays,
      maxBranches,
      maxProfessionals,
      maxUsers,
      position,
      publicVisible: input.publicVisible,
      tagline,
      features,
      ctaLabel,
      checkoutUrlMonthly,
      checkoutUrlQuarterly,
      checkoutUrlYearly,
      highlight: input.highlight,
      highlightLabel,
    },
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error) && (error as { code?: string }).code === "23505";
}

/** O CHECK do banco, quando alguém contorna a validação da tela. */
function isCheckViolation(error: unknown, constraint: string): boolean {
  const e = error as { code?: string; constraint?: string } | null;
  return Boolean(e) && e?.code === "23514" && e?.constraint === constraint;
}

/**
 * A landing entra na lista porque ela renderiza os planos da vitrine e é
 * estática: sem invalidar aqui, marcar "aparece no site" só teria efeito no
 * próximo deploy — e quem mexeu ia concluir que o painel não salvou.
 */
function revalidatePlanSurfaces() {
  revalidatePath("/admin/planos");
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function savePlanAction(input: unknown, planId?: number): Promise<PlanResult> {
  await requirePlatformAdmin();

  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Confira os campos do formulário." };

  const normalized = normalize(parsed.data, !planId);
  if (!normalized.ok) return normalized;
  const { slug, ...fields } = normalized.value;

  try {
    let saved: number;

    if (planId) {
      // `slug` fica de fora do SET de propósito: as assinaturas e o histórico de
      // MRR apontam para o plano, e renomear o identificador quebraria a leitura
      // de tudo que já aconteceu.
      const [row] = await db
        .update(plans)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(plans.id, planId))
        .returning({ id: plans.id });
      if (!row) return { ok: false, error: "Esse plano não existe mais." };
      saved = row.id;
    } else {
      const [existing] = await db
        .select({ id: plans.id })
        .from(plans)
        .where(eq(plans.slug, slug))
        .limit(1);
      if (existing) {
        return { ok: false, error: "Já existe um plano com esse identificador.", field: "slug" };
      }
      const [row] = await db
        .insert(plans)
        .values({ slug, ...fields, active: true })
        .returning({ id: plans.id });
      saved = row.id;
    }

    revalidatePlanSurfaces();
    return { ok: true, planId: saved };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: "Já existe um plano com esse identificador.", field: "slug" };
    }
    if (isCheckViolation(error, "plans_checkout_urls_https")) {
      return {
        ok: false,
        error: "O link de checkout precisa começar com https://.",
        field: "checkoutUrlMonthly",
      };
    }
    console.error(error);
    return { ok: false, error: "Não foi possível salvar o plano. Tente de novo." };
  }
}

/**
 * Desativar tira o plano da vitrine (não aceita nova assinatura). Quem já assina
 * continua exatamente como está — por isso não há evento de MRR aqui.
 */
export async function setPlanActiveAction(planId: number, active: boolean): Promise<PlanResult> {
  await requirePlatformAdmin();

  try {
    const [row] = await db
      .update(plans)
      .set({ active })
      .where(eq(plans.id, planId))
      .returning({ id: plans.id });
    if (!row) return { ok: false, error: "Esse plano não existe mais." };

    // A vitrine também filtra por `active`: desativar tira o plano do site sem
    // que ninguém desmarque "aparece no site".
    revalidatePlanSurfaces();
    return { ok: true, planId: row.id };
  } catch (error) {
    console.error(error);
    return { ok: false, error: "Não foi possível mudar a situação do plano." };
  }
}

/**
 * Excluir só é permitido para plano que nunca foi vendido. Assinatura viva ou
 * qualquer passagem pelo histórico prende o registro: o movimento de MRR do
 * painel lê o plano de antes e o de depois de cada evento.
 */
export async function deletePlanAction(planId: number): Promise<PlanResult> {
  await requirePlatformAdmin();

  const [subsRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(subscriptions)
    .where(eq(subscriptions.planId, planId));
  const linked = Number(subsRow?.total ?? 0);
  if (linked > 0) {
    return {
      ok: false,
      error: `Este plano tem ${linked} ${linked === 1 ? "assinatura vinculada" : "assinaturas vinculadas"}. Desative em vez de excluir.`,
    };
  }

  const [eventsRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(subscriptionEvents)
    .where(
      or(
        eq(subscriptionEvents.planIdBefore, planId),
        eq(subscriptionEvents.planIdAfter, planId),
      ),
    );
  if (Number(eventsRow?.total ?? 0) > 0) {
    return {
      ok: false,
      error: "Este plano já aparece no histórico de assinaturas. Desative em vez de excluir — o gráfico de MRR depende do registro.",
    };
  }

  try {
    const [row] = await db.delete(plans).where(eq(plans.id, planId)).returning({ id: plans.id });
    if (!row) return { ok: false, error: "Esse plano não existe mais." };

    revalidatePlanSurfaces();
    return { ok: true, planId: row.id };
  } catch (error) {
    console.error(error);
    return {
      ok: false,
      error: "Não foi possível excluir o plano. Se ele já foi usado por alguma conta, desative em vez de excluir.",
    };
  }
}
