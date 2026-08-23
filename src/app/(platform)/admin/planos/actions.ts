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
  yearlyPrice: z.string(),
  trialDays: z.string(),
  maxBranches: z.string(),
  maxProfessionals: z.string(),
  maxUsers: z.string(),
  position: z.string(),
});

export type PlanPayload = z.infer<typeof payloadSchema>;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type PlanValues = {
  slug: string;
  name: string;
  description: string | null;
  monthlyPriceCents: number;
  yearlyPriceCents: number;
  trialDays: number;
  maxBranches: number | null;
  maxProfessionals: number | null;
  maxUsers: number | null;
  position: number;
};

type Normalized = { ok: true; value: PlanValues } | { ok: false; error: string; field: string };

const invalid = (field: string, error: string): Normalized => ({ ok: false, error, field });

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
  const yearlyPriceCents = parseBRL(input.yearlyPrice);
  if (yearlyPriceCents === null) return invalid("yearlyPrice", "Informe o preço anual em reais.");
  if (monthlyPriceCents > 5_000_000 || yearlyPriceCents > 50_000_000) {
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
  if (maxBranches !== null && typeof maxBranches === "object") return maxBranches;
  const maxProfessionals = limit(input.maxProfessionals, "maxProfessionals", "Profissionais");
  if (maxProfessionals !== null && typeof maxProfessionals === "object") return maxProfessionals;
  const maxUsers = limit(input.maxUsers, "maxUsers", "Usuários");
  if (maxUsers !== null && typeof maxUsers === "object") return maxUsers;

  return {
    ok: true,
    value: {
      slug,
      name,
      description: input.description.trim() || null,
      monthlyPriceCents,
      yearlyPriceCents,
      trialDays,
      maxBranches,
      maxProfessionals,
      maxUsers,
      position,
    },
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error) && (error as { code?: string }).code === "23505";
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
        .set(fields)
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

    revalidatePath("/admin/planos");
    revalidatePath("/admin");
    return { ok: true, planId: saved };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: "Já existe um plano com esse identificador.", field: "slug" };
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

    revalidatePath("/admin/planos");
    revalidatePath("/admin");
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

    revalidatePath("/admin/planos");
    revalidatePath("/admin");
    return { ok: true, planId: row.id };
  } catch (error) {
    console.error(error);
    return {
      ok: false,
      error: "Não foi possível excluir o plano. Se ele já foi usado por alguma conta, desative em vez de excluir.",
    };
  }
}
