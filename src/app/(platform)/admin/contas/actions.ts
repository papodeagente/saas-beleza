"use server";

import { addDays, addMonths, addYears } from "date-fns";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { organizations, plans, subscriptionEvents, subscriptions } from "@/db/schema";
import { requirePlatformAdmin } from "@/server/platform-auth";
import { CreateAccountError, createAccount } from "@/server/services/platform-account-create";

/**
 * Mutações de assinatura feitas à mão pelo painel da plataforma.
 *
 * REGRA QUE MANDA AQUI: o gráfico de MRR do painel é reconstruído a partir de
 * `subscription_events`, não do estado atual das assinaturas. Uma mutação que
 * não grave o evento na MESMA transação não some do relatório — ela mente
 * nele, porque o movimento do mês passa a não fechar com o saldo. Por isso
 * toda escrita abaixo passa por `writeSubscription`, que só sabe salvar
 * assinatura junto com evento.
 *
 * Suspensão de conta é a exceção deliberada: bloqueia ACESSO, não cobra nem
 * descobra nada, então não gera evento de receita.
 */

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

const PAYING: string[] = ["active", "past_due"];

/** MRR normalizado para o mês. Teste e cancelada valem ZERO. */
function monthlyMrr(status: string, cycle: string, priceCents: number): number {
  if (!PAYING.includes(status)) return 0;
  return cycle === "yearly" ? Math.round(priceCents / 12) : priceCents;
}

function periodEnd(from: Date, cycle: "monthly" | "yearly"): Date {
  return cycle === "yearly" ? addYears(from, 1) : addMonths(from, 1);
}

function revalidate(organizationId: number) {
  revalidatePath("/admin");
  revalidatePath("/admin/contas");
  revalidatePath(`/admin/contas/${organizationId}`);
}

function fail(error: unknown, fallback: string): ActionResult {
  if (error instanceof Error && error.message === "NOT_PLATFORM_ADMIN") {
    return { ok: false, error: "Sessão sem permissão de plataforma." };
  }
  console.error(error);
  return { ok: false, error: fallback };
}

const orgId = z.coerce.number().int().positive();
const reason = z.string().trim().min(3, "Escreva o motivo — ele fica no histórico.").max(400);

// ---------------------------------------------------------------------------
// Trocar plano ou ciclo
// ---------------------------------------------------------------------------

const changePlanSchema = z.object({
  organizationId: orgId,
  planId: z.coerce.number().int().positive(),
  cycle: z.enum(["monthly", "yearly"]),
});

export async function changePlanAction(input: unknown): Promise<ActionResult> {
  const parsed = changePlanSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { organizationId, planId, cycle } = parsed.data;

  try {
    const ctx = await requirePlatformAdmin();

    return await db.transaction(async (tx) => {
      const [sub] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.organizationId, organizationId))
        .limit(1)
        .for("update");
      if (!sub) return { ok: false, error: "Esta conta ainda não tem assinatura." } as ActionResult;

      const [plan] = await tx.select().from(plans).where(eq(plans.id, planId)).limit(1);
      if (!plan) return { ok: false, error: "Plano não encontrado." } as ActionResult;

      const priceCents = cycle === "yearly" ? plan.yearlyPriceCents : plan.monthlyPriceCents;
      if (sub.planId === planId && sub.cycle === cycle && sub.priceCents === priceCents) {
        return { ok: false, error: "O plano e o ciclo já são esses." } as ActionResult;
      }

      const before = monthlyMrr(sub.status, sub.cycle, sub.priceCents);
      const after = monthlyMrr(sub.status, cycle, priceCents);

      await tx
        .update(subscriptions)
        .set({ planId, cycle, priceCents, updatedAt: new Date() })
        .where(eq(subscriptions.id, sub.id));

      await tx.insert(subscriptionEvents).values({
        organizationId,
        subscriptionId: sub.id,
        // O tipo sai da variação de RECEITA, não do preço de tabela: assinatura
        // em teste vale zero dos dois lados e não pode virar "expansão".
        kind: after > before ? "upgraded" : after < before ? "downgraded" : "cycle_changed",
        mrrBeforeCents: before,
        mrrAfterCents: after,
        planIdBefore: sub.planId,
        planIdAfter: planId,
        source: "platform_admin",
        note: `Plano alterado para ${plan.name} (${cycle === "yearly" ? "anual" : "mensal"}) por ${ctx.userName}.`,
        payload: { actorUserId: ctx.userId, actorEmail: ctx.userEmail },
      });

      revalidate(organizationId);
      return { ok: true, message: `Plano alterado para ${plan.name}.` } as ActionResult;
    });
  } catch (error) {
    return fail(error, "Não foi possível trocar o plano. Tente de novo.");
  }
}

// ---------------------------------------------------------------------------
// Cancelar
// ---------------------------------------------------------------------------

const cancelSchema = z.object({ organizationId: orgId, reason });

export async function cancelSubscriptionAction(input: unknown): Promise<ActionResult> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { organizationId, reason: motivo } = parsed.data;

  try {
    const ctx = await requirePlatformAdmin();

    return await db.transaction(async (tx) => {
      const [sub] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.organizationId, organizationId))
        .limit(1)
        .for("update");
      if (!sub) return { ok: false, error: "Esta conta ainda não tem assinatura." } as ActionResult;
      if (sub.status === "canceled") {
        return { ok: false, error: "Esta assinatura já está cancelada." } as ActionResult;
      }

      const before = monthlyMrr(sub.status, sub.cycle, sub.priceCents);
      const now = new Date();

      await tx
        .update(subscriptions)
        .set({ status: "canceled", canceledAt: now, cancelReason: motivo, updatedAt: now })
        .where(eq(subscriptions.id, sub.id));

      await tx.insert(subscriptionEvents).values({
        organizationId,
        subscriptionId: sub.id,
        kind: "canceled",
        mrrBeforeCents: before,
        mrrAfterCents: 0,
        planIdBefore: sub.planId,
        planIdAfter: sub.planId,
        source: "platform_admin",
        note: motivo,
        payload: { actorUserId: ctx.userId, actorEmail: ctx.userEmail },
        occurredAt: now,
      });

      revalidate(organizationId);
      return { ok: true, message: "Assinatura cancelada." } as ActionResult;
    });
  } catch (error) {
    return fail(error, "Não foi possível cancelar a assinatura. Tente de novo.");
  }
}

// ---------------------------------------------------------------------------
// Reativar assinatura cancelada
// ---------------------------------------------------------------------------

const reactivateSchema = z.object({ organizationId: orgId });

export async function reactivateSubscriptionAction(input: unknown): Promise<ActionResult> {
  const parsed = reactivateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { organizationId } = parsed.data;

  try {
    const ctx = await requirePlatformAdmin();

    return await db.transaction(async (tx) => {
      const [sub] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.organizationId, organizationId))
        .limit(1)
        .for("update");
      if (!sub) return { ok: false, error: "Esta conta ainda não tem assinatura." } as ActionResult;
      if (PAYING.includes(sub.status)) {
        return { ok: false, error: "Esta assinatura já está ativa." } as ActionResult;
      }
      if (sub.status === "trialing") {
        return {
          ok: false,
          error: "Esta conta está em teste — use “Converter teste em assinatura”.",
        } as ActionResult;
      }

      const now = new Date();
      const after = monthlyMrr("active", sub.cycle, sub.priceCents);

      await tx
        .update(subscriptions)
        .set({
          status: "active",
          canceledAt: null,
          cancelReason: null,
          startedAt: sub.startedAt ?? now,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd(now, sub.cycle),
          updatedAt: now,
        })
        .where(eq(subscriptions.id, sub.id));

      await tx.insert(subscriptionEvents).values({
        organizationId,
        subscriptionId: sub.id,
        kind: "reactivated",
        mrrBeforeCents: 0,
        mrrAfterCents: after,
        planIdBefore: sub.planId,
        planIdAfter: sub.planId,
        source: "platform_admin",
        note: `Assinatura reativada por ${ctx.userName}.`,
        payload: { actorUserId: ctx.userId, actorEmail: ctx.userEmail },
        occurredAt: now,
      });

      revalidate(organizationId);
      return { ok: true, message: "Assinatura reativada." } as ActionResult;
    });
  } catch (error) {
    return fail(error, "Não foi possível reativar a assinatura. Tente de novo.");
  }
}

// ---------------------------------------------------------------------------
// Converter teste em assinatura paga
// ---------------------------------------------------------------------------

const convertSchema = z.object({ organizationId: orgId });

export async function convertTrialAction(input: unknown): Promise<ActionResult> {
  const parsed = convertSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { organizationId } = parsed.data;

  try {
    const ctx = await requirePlatformAdmin();

    return await db.transaction(async (tx) => {
      const [sub] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.organizationId, organizationId))
        .limit(1)
        .for("update");
      if (!sub) return { ok: false, error: "Esta conta ainda não tem assinatura." } as ActionResult;
      if (sub.status !== "trialing") {
        return { ok: false, error: "Só uma conta em teste pode ser convertida." } as ActionResult;
      }

      const now = new Date();
      const after = monthlyMrr("active", sub.cycle, sub.priceCents);

      await tx
        .update(subscriptions)
        .set({
          status: "active",
          trialEndsAt: now,
          startedAt: sub.startedAt ?? now,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd(now, sub.cycle),
          updatedAt: now,
        })
        .where(eq(subscriptions.id, sub.id));

      await tx.insert(subscriptionEvents).values({
        organizationId,
        subscriptionId: sub.id,
        kind: "trial_converted",
        mrrBeforeCents: 0,
        mrrAfterCents: after,
        planIdBefore: sub.planId,
        planIdAfter: sub.planId,
        source: "platform_admin",
        note: `Teste convertido em assinatura por ${ctx.userName}.`,
        payload: { actorUserId: ctx.userId, actorEmail: ctx.userEmail },
        occurredAt: now,
      });

      revalidate(organizationId);
      return { ok: true, message: "Teste convertido em assinatura." } as ActionResult;
    });
  } catch (error) {
    return fail(error, "Não foi possível converter o teste. Tente de novo.");
  }
}

// ---------------------------------------------------------------------------
// Estender teste — não mexe em receita, então NÃO gera evento de MRR
// ---------------------------------------------------------------------------

const extendSchema = z.object({
  organizationId: orgId,
  days: z.coerce.number().int().min(1, "Mínimo de 1 dia.").max(90, "Máximo de 90 dias."),
});

export async function extendTrialAction(input: unknown): Promise<ActionResult> {
  const parsed = extendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { organizationId, days } = parsed.data;

  try {
    await requirePlatformAdmin();

    return await db.transaction(async (tx) => {
      const [sub] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.organizationId, organizationId))
        .limit(1)
        .for("update");
      if (!sub) return { ok: false, error: "Esta conta ainda não tem assinatura." } as ActionResult;
      if (sub.status !== "trialing") {
        return { ok: false, error: "Só dá para estender o teste de uma conta em teste." } as ActionResult;
      }

      const now = new Date();
      // Teste vencido volta a contar de hoje; teste em curso ganha os dias no fim.
      const base = sub.trialEndsAt && sub.trialEndsAt > now ? sub.trialEndsAt : now;

      await tx
        .update(subscriptions)
        .set({ trialEndsAt: addDays(base, days), updatedAt: now })
        .where(eq(subscriptions.id, sub.id));

      revalidate(organizationId);
      return {
        ok: true,
        message: `Teste estendido em ${days} ${days === 1 ? "dia" : "dias"}.`,
      } as ActionResult;
    });
  } catch (error) {
    return fail(error, "Não foi possível estender o teste. Tente de novo.");
  }
}

// ---------------------------------------------------------------------------
// Suspender / devolver acesso — ACESSO, não receita
// ---------------------------------------------------------------------------

const suspendSchema = z.object({ organizationId: orgId, reason });

export async function suspendAccountAction(input: unknown): Promise<ActionResult> {
  const parsed = suspendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { organizationId, reason: motivo } = parsed.data;

  try {
    await requirePlatformAdmin();

    return await db.transaction(async (tx) => {
      const [org] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1)
        .for("update");
      if (!org) return { ok: false, error: "Conta não encontrada." } as ActionResult;
      if (org.suspendedAt) return { ok: false, error: "Esta conta já está suspensa." } as ActionResult;

      await tx
        .update(organizations)
        .set({ suspendedAt: new Date(), suspendedReason: motivo })
        .where(eq(organizations.id, organizationId));

      revalidate(organizationId);
      return { ok: true, message: "Conta suspensa. A clínica perdeu o acesso." } as ActionResult;
    });
  } catch (error) {
    return fail(error, "Não foi possível suspender a conta. Tente de novo.");
  }
}

const resumeSchema = z.object({ organizationId: orgId });

export async function resumeAccountAction(input: unknown): Promise<ActionResult> {
  const parsed = resumeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { organizationId } = parsed.data;

  try {
    await requirePlatformAdmin();

    return await db.transaction(async (tx) => {
      const [org] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1)
        .for("update");
      if (!org) return { ok: false, error: "Conta não encontrada." } as ActionResult;
      if (!org.suspendedAt) return { ok: false, error: "Esta conta não está suspensa." } as ActionResult;

      await tx
        .update(organizations)
        .set({ suspendedAt: null, suspendedReason: null })
        .where(eq(organizations.id, organizationId));

      revalidate(organizationId);
      return { ok: true, message: "Acesso devolvido à clínica." } as ActionResult;
    });
  } catch (error) {
    return fail(error, "Não foi possível devolver o acesso. Tente de novo.");
  }
}

// ---------------------------------------------------------------------------
// Cadastrar uma conta nova
// ---------------------------------------------------------------------------

/**
 * O formulário mostra o erro embaixo do campo que o causou. Uma action que só
 * devolvesse uma frase geral obrigaria a pessoa a caçar qual dos sete campos
 * está errado.
 */
export type CreateAccountActionResult =
  | { ok: true; message: string; organizationId: number; publicId: string }
  | { ok: false; error: string; fields?: Record<string, string> };

const createAccountSchema = z.object({
  clinicName: z.string().trim().min(2, "Escreva o nome da clínica.").max(120),
  timezone: z.string().trim().min(3),
  ownerName: z.string().trim().min(2, "Escreva o nome de quem responde pela conta."),
  ownerEmail: z.string().trim().toLowerCase().email("Informe um e-mail válido."),
  ownerPassword: z.string().min(8, "A senha precisa de pelo menos 8 caracteres."),
  planId: z.coerce.number().int().positive("Escolha um plano."),
  cycle: z.enum(["monthly", "yearly"]),
  start: z.enum(["trial", "active"]),
});

export async function createAccountAction(input: unknown): Promise<CreateAccountActionResult> {
  const parsed = createAccountSchema.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const campo = String(issue.path[0] ?? "");
      if (campo && !fields[campo]) fields[campo] = issue.message;
    }
    return { ok: false, error: "Revise os campos destacados.", fields };
  }

  try {
    const ctx = await requirePlatformAdmin();
    // Ator explícito: só o painel pode adotar um e-mail que já tem login, e é
    // este objeto que autoriza (o autocadastro público passa `self_signup` e
    // esbarra em EMAIL_TAKEN).
    const resultado = await createAccount({ kind: "platform_admin", ctx }, parsed.data);

    revalidatePath("/admin");
    revalidatePath("/admin/contas");

    return {
      ok: true,
      organizationId: resultado.organizationId,
      // Quem cadastra é quem vai passar o código adiante: devolver aqui evita
      // ter que abrir a conta de novo só para descobri-lo.
      publicId: resultado.publicId,
      message: resultado.ownerReused
        ? `${parsed.data.clinicName} cadastrada. ${parsed.data.ownerName} já tinha login e foi vinculada como responsável — a senha dela não mudou.`
        : `${parsed.data.clinicName} cadastrada.`,
    };
  } catch (error) {
    if (error instanceof CreateAccountError) return { ok: false, error: error.message };
    const resultado = fail(error, "Não foi possível cadastrar a conta. Tente de novo.");
    return resultado as CreateAccountActionResult;
  }
}
