"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, requireSession } from "@/server/auth";
import { DomainError } from "@/server/services/appointment-service";
import {
  createScheduleBlock,
  removeScheduleBlock,
  saveProfessionalHours,
} from "@/server/services/schedule-settings-service";
import type { ActionResult } from "./actions";

/**
 * Escrita da disponibilidade. Mexer na jornada muda o que o booking público e
 * o agente de IA oferecem, então é ação de administração, não de recepção.
 */

function fail(error: unknown): ActionResult {
  if (error instanceof DomainError) return { ok: false, error: error.message };
  console.error(error);
  return { ok: false, error: "Não foi possível salvar a disponibilidade. Tente de novo." };
}

/** Revalida tudo que lê horário livre a partir da grade. */
function revalidateSchedule() {
  revalidatePath("/agenda");
  revalidatePath("/hoje");
  revalidatePath("/gestao");
}

const hoursSchema = z.object({
  professionalId: z.number().int().positive(),
  branchId: z.number().int().positive(),
  ranges: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        startTime: z.string(),
        endTime: z.string(),
      }),
    )
    .max(42, "São no máximo seis períodos por dia."),
});

export async function saveWorkingHoursAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    const data = hoursSchema.parse(input);
    await saveProfessionalHours(ctx, data);
    revalidateSchedule();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const blockSchema = z.object({
  professionalId: z.number().int().positive(),
  branchId: z.number().int().positive().nullable().optional(),
  startsAt: z.string(),
  endsAt: z.string(),
  reason: z.string().max(200).nullable().optional(),
});

export async function createBlockAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    const data = blockSchema.parse(input);
    await createScheduleBlock(ctx, {
      professionalId: data.professionalId,
      branchId: data.branchId ?? null,
      startsAt: new Date(data.startsAt),
      endsAt: new Date(data.endsAt),
      reason: data.reason ?? null,
    });
    revalidateSchedule();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const removeBlockSchema = z.object({ blockId: z.number().int().positive() });

export async function removeBlockAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    const data = removeBlockSchema.parse(input);
    await removeScheduleBlock(ctx, data.blockId);
    revalidateSchedule();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
