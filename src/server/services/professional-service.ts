import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appointments,
  auditLogs,
  commissions,
  professionalServices,
  professionalWorkingHours,
  professionals,
  scheduleBlocks,
  services,
} from "@/db/schema";
import type { TenantContext } from "@/server/auth";

/**
 * Profissionais — editar e excluir.
 *
 * Mesma história de `branch-service`: `gestao/actions.ts` só sabia CRIAR
 * profissional. Ajustar uma comissão digitada errado, ou tirar alguém que
 * saiu do salão, não tinha caminho — a clínica convivia com o cadastro do
 * jeito que entrou.
 *
 * A GUARDA MULTI-TENANT É O PRÓPRIO `where`: todo update/delete casa `id` E
 * `organizationId`, e a ausência de linha devolvida é o que denuncia a
 * tentativa de mexer em profissional de outra clínica.
 */

export class ProfessionalError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ProfessionalUpdateInput = {
  name: string;
  specialty: string | null;
  color: string;
  commissionPct: number;
  active: boolean;
  serviceIds: number[];
};

type ProfessionalRow = typeof professionals.$inferSelect;

/** Só o que interessa ao rastro — o objeto inteiro vira um diário que ninguém lê. */
function paraRastro(campos: Pick<ProfessionalRow, "name" | "specialty" | "color" | "commissionBps" | "active">) {
  return {
    name: campos.name,
    specialty: campos.specialty,
    color: campos.color,
    commissionBps: campos.commissionBps,
    active: campos.active,
  };
}

async function registrar(
  tx: Tx,
  ctx: TenantContext,
  professionalId: number,
  acao: string,
  antes: Record<string, unknown> | null,
  depois: Record<string, unknown>,
): Promise<void> {
  const mudou = antes
    ? Object.keys(depois).filter((chave) => !Object.is(antes[chave], depois[chave]))
    : Object.keys(depois);
  if (mudou.length === 0) return;
  await tx.insert(auditLogs).values({
    organizationId: ctx.organizationId,
    actorType: "user",
    actorId: ctx.userId,
    entity: "professional",
    entityId: professionalId,
    action: acao,
    before: antes ? Object.fromEntries(mudou.map((c) => [c, antes[c]])) : null,
    after: Object.fromEntries(mudou.map((c) => [c, depois[c]])),
  });
}

/**
 * Atualiza nome, especialidade, cor, comissão, status e os serviços que o
 * profissional realiza.
 *
 * Jornada e unidade continuam em Agenda › Disponibilidade — duplicar aquele
 * editor aqui só criaria duas fontes da verdade para o mesmo horário.
 */
export async function updateProfessional(
  ctx: TenantContext,
  professionalId: number,
  input: ProfessionalUpdateInput,
): Promise<void> {
  const validServices = input.serviceIds.length
    ? await db
        .select({ id: services.id })
        .from(services)
        .where(and(eq(services.organizationId, ctx.organizationId), inArray(services.id, input.serviceIds)))
    : [];
  if (validServices.length !== new Set(input.serviceIds).size) {
    throw new ProfessionalError("Um dos serviços selecionados é inválido.", "SERVICO_INVALIDO", "serviceIds");
  }

  const campos = {
    name: input.name.trim(),
    specialty: input.specialty?.trim() || null,
    color: input.color,
    commissionBps: Math.round(input.commissionPct * 100),
    active: input.active,
  };

  await db.transaction(async (tx) => {
    // O estado anterior serve ao rastro, NÃO à guarda de tenant: quem guarda
    // é o `where` do update, logo abaixo.
    const [antes] = await tx
      .select()
      .from(professionals)
      .where(and(eq(professionals.id, professionalId), eq(professionals.organizationId, ctx.organizationId)))
      .limit(1);

    const [atualizado] = await tx
      .update(professionals)
      .set(campos)
      .where(and(eq(professionals.id, professionalId), eq(professionals.organizationId, ctx.organizationId)))
      .returning({ id: professionals.id });
    if (!atualizado) throw new ProfessionalError("Profissional não encontrado.", "NAO_ENCONTRADO");

    await tx.delete(professionalServices).where(eq(professionalServices.professionalId, professionalId));
    if (validServices.length) {
      await tx.insert(professionalServices).values(
        validServices.map((service) => ({
          organizationId: ctx.organizationId,
          professionalId,
          serviceId: service.id,
        })),
      );
    }

    await registrar(tx, ctx, professionalId, "updated", antes ? paraRastro(antes) : null, paraRastro(campos));
  });
}

/**
 * Exclui o profissional — ou, quando ele já tem atendimento ou comissão no
 * histórico, apenas o desativa.
 *
 * Excluir de verdade nesse caso apagaria (ou quebraria a referência de)
 * registros financeiros e da agenda que já aconteceram — o mesmo raciocínio
 * de `setBranchActive`. Sem histórico, a linha some de verdade.
 */
export async function deleteProfessional(
  ctx: TenantContext,
  professionalId: number,
): Promise<{ deactivated: boolean }> {
  const [existing] = await db
    .select()
    .from(professionals)
    .where(and(eq(professionals.id, professionalId), eq(professionals.organizationId, ctx.organizationId)))
    .limit(1);
  if (!existing) throw new ProfessionalError("Profissional não encontrado.", "NAO_ENCONTRADO");

  const [[{ count: appointmentCount }], [{ count: commissionCount }]] = await Promise.all([
    db.select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(appointments)
      .where(eq(appointments.professionalId, professionalId)),
    db.select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(commissions)
      .where(eq(commissions.professionalId, professionalId)),
  ]);

  // Abaixo não é `registrar`: aquele helper pula a gravação quando o diff
  // fica vazio, o que é certo para `update` (nada mudou, nada a logar) mas
  // apagaria o rastro de uma exclusão — aqui o antes/depois é sempre gravado.
  if (appointmentCount > 0 || commissionCount > 0) {
    await db.transaction(async (tx) => {
      await tx.update(professionals).set({ active: false }).where(eq(professionals.id, professionalId));
      await tx.insert(auditLogs).values({
        organizationId: ctx.organizationId,
        actorType: "user",
        actorId: ctx.userId,
        entity: "professional",
        entityId: professionalId,
        action: "deactivated",
        before: paraRastro(existing),
        after: { ...paraRastro(existing), active: false },
      });
    });
    return { deactivated: true };
  }

  await db.transaction(async (tx) => {
    await tx.delete(professionalWorkingHours).where(eq(professionalWorkingHours.professionalId, professionalId));
    await tx.delete(scheduleBlocks).where(eq(scheduleBlocks.professionalId, professionalId));
    await tx.delete(professionalServices).where(eq(professionalServices.professionalId, professionalId));
    await tx.delete(professionals).where(eq(professionals.id, professionalId));
    await tx.insert(auditLogs).values({
      organizationId: ctx.organizationId,
      actorType: "user",
      actorId: ctx.userId,
      entity: "professional",
      entityId: professionalId,
      action: "deleted",
      before: paraRastro(existing),
      after: null,
    });
  });
  return { deactivated: false };
}
