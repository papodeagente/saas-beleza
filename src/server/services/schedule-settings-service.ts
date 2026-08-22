import "server-only";
import { and, asc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { professionalWorkingHours, professionals, scheduleBlocks, branches } from "@/db/schema";
import { type TimeRange, toHHmm, validateDayRanges } from "@/domain/working-hours";
import type { TenantContext } from "@/server/auth";
import { DomainError } from "./appointment-service";

/**
 * Escrita da disponibilidade: jornada semanal e bloqueios pontuais.
 *
 * A LEITURA para calcular horário livre continua no availability-service —
 * este módulo só existe porque a grade precisava ser editável por dentro do
 * produto, e não apenas pelo seed.
 */

export type WorkingHourRow = {
  id: number;
  professionalId: number;
  branchId: number;
  weekday: number;
  startTime: string;
  endTime: string;
};

export type ScheduleBlockRow = {
  id: number;
  professionalId: number;
  branchId: number | null;
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
};

export type ScheduleSettings = {
  hours: WorkingHourRow[];
  blocks: ScheduleBlockRow[];
};

/** Jornada de todos os profissionais + bloqueios que ainda valem. */
export async function getScheduleSettings(ctx: TenantContext): Promise<ScheduleSettings> {
  const [hourRows, blockRows] = await Promise.all([
    db
      .select({
        id: professionalWorkingHours.id,
        professionalId: professionalWorkingHours.professionalId,
        branchId: professionalWorkingHours.branchId,
        weekday: professionalWorkingHours.weekday,
        startTime: professionalWorkingHours.startTime,
        endTime: professionalWorkingHours.endTime,
      })
      .from(professionalWorkingHours)
      .where(eq(professionalWorkingHours.organizationId, ctx.organizationId))
      .orderBy(asc(professionalWorkingHours.weekday), asc(professionalWorkingHours.startTime)),
    // Bloqueio que já terminou é histórico: não entra na tela de edição.
    db
      .select({
        id: scheduleBlocks.id,
        professionalId: scheduleBlocks.professionalId,
        branchId: scheduleBlocks.branchId,
        startsAt: scheduleBlocks.startsAt,
        endsAt: scheduleBlocks.endsAt,
        reason: scheduleBlocks.reason,
      })
      .from(scheduleBlocks)
      .where(and(eq(scheduleBlocks.organizationId, ctx.organizationId), gte(scheduleBlocks.endsAt, new Date())))
      .orderBy(asc(scheduleBlocks.startsAt)),
  ]);

  return {
    hours: hourRows.map((row) => ({ ...row, startTime: toHHmm(row.startTime), endTime: toHHmm(row.endTime) })),
    blocks: blockRows,
  };
}

/** O profissional é do tenant? Sem isso, um id chutado editaria a agenda alheia. */
async function assertProfessional(ctx: TenantContext, professionalId: number) {
  const [row] = await db
    .select({ id: professionals.id })
    .from(professionals)
    .where(and(eq(professionals.id, professionalId), eq(professionals.organizationId, ctx.organizationId)))
    .limit(1);
  if (!row) throw new DomainError("Profissional não encontrado.", "PROFESSIONAL_NOT_FOUND");
}

async function assertBranch(ctx: TenantContext, branchId: number) {
  const [row] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.organizationId, ctx.organizationId)))
    .limit(1);
  if (!row) throw new DomainError("Unidade não encontrada.", "BRANCH_NOT_FOUND");
}

export type WeeklyRange = TimeRange & { weekday: number };

/**
 * Substitui a jornada de um profissional NUMA unidade.
 *
 * O recorte por unidade é o que permite trabalhar de manhã numa e à tarde em
 * outra: gravar a grade de uma unidade não pode apagar a da outra.
 */
export async function saveProfessionalHours(
  ctx: TenantContext,
  input: { professionalId: number; branchId: number; ranges: WeeklyRange[] },
): Promise<void> {
  await Promise.all([
    assertProfessional(ctx, input.professionalId),
    assertBranch(ctx, input.branchId),
  ]);

  for (const range of input.ranges) {
    if (!Number.isInteger(range.weekday) || range.weekday < 0 || range.weekday > 6) {
      throw new DomainError("Dia da semana inválido.", "WEEKDAY_INVALID");
    }
  }

  // Mesma validação da tela — aqui ela é o árbitro, lá é só o aviso antecipado.
  for (let weekday = 0; weekday <= 6; weekday++) {
    const error = validateDayRanges(input.ranges.filter((r) => r.weekday === weekday));
    if (error) throw new DomainError(error, "WORKING_HOURS_INVALID");
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(professionalWorkingHours)
      .where(
        and(
          eq(professionalWorkingHours.organizationId, ctx.organizationId),
          eq(professionalWorkingHours.professionalId, input.professionalId),
          eq(professionalWorkingHours.branchId, input.branchId),
        ),
      );

    if (input.ranges.length === 0) return;

    await tx.insert(professionalWorkingHours).values(
      input.ranges.map((range) => ({
        organizationId: ctx.organizationId,
        professionalId: input.professionalId,
        branchId: input.branchId,
        weekday: range.weekday,
        startTime: toHHmm(range.startTime),
        endTime: toHHmm(range.endTime),
      })),
    );
  });
}

export async function createScheduleBlock(
  ctx: TenantContext,
  input: { professionalId: number; branchId?: number | null; startsAt: Date; endsAt: Date; reason?: string | null },
): Promise<ScheduleBlockRow> {
  await assertProfessional(ctx, input.professionalId);
  if (input.branchId) await assertBranch(ctx, input.branchId);
  if (input.endsAt <= input.startsAt) {
    throw new DomainError("O fim do bloqueio precisa ser depois do início.", "BLOCK_INVALID");
  }

  const [created] = await db
    .insert(scheduleBlocks)
    .values({
      organizationId: ctx.organizationId,
      professionalId: input.professionalId,
      branchId: input.branchId ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      reason: input.reason?.trim() || null,
    })
    .returning({
      id: scheduleBlocks.id,
      professionalId: scheduleBlocks.professionalId,
      branchId: scheduleBlocks.branchId,
      startsAt: scheduleBlocks.startsAt,
      endsAt: scheduleBlocks.endsAt,
      reason: scheduleBlocks.reason,
    });
  return created;
}

export async function removeScheduleBlock(ctx: TenantContext, blockId: number): Promise<void> {
  const deleted = await db
    .delete(scheduleBlocks)
    .where(and(eq(scheduleBlocks.id, blockId), eq(scheduleBlocks.organizationId, ctx.organizationId)))
    .returning({ id: scheduleBlocks.id });
  if (deleted.length === 0) throw new DomainError("Bloqueio não encontrado.", "BLOCK_NOT_FOUND");
}
