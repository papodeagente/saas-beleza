"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/server/auth";
import type { AppointmentStatus } from "@/domain/appointment-status";
import {
  DomainError,
  changeStatus,
  createAppointment,
  registerPayment,
  rescheduleAppointment,
} from "@/server/services/appointment-service";
import { getAvailableSlots } from "@/server/services/availability-service";

export type ActionResult = { ok: true } | { ok: false; error: string };

function fail(error: unknown): ActionResult {
  if (error instanceof DomainError) return { ok: false, error: error.message };
  console.error(error);
  return {
    ok: false,
    error: "Não foi possível concluir a ação. Tente de novo em alguns segundos.",
  };
}

const statusSchema = z.object({
  appointmentId: z.number().int().positive(),
  status: z.enum([
    "scheduled",
    "confirmed",
    "checked_in",
    "in_progress",
    "completed",
    "cancelled",
    "no_show",
  ]),
  cancelReason: z.string().max(300).optional(),
});

export async function updateStatusAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requireSession();
    const data = statusSchema.parse(input);
    await changeStatus(ctx, data.appointmentId, data.status as AppointmentStatus, {
      cancelReason: data.cancelReason,
    });
    revalidatePath("/agenda");
    revalidatePath("/hoje");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const paymentSchema = z.object({
  appointmentId: z.number().int().positive(),
  method: z.enum(["pix", "cartao_credito", "cartao_debito", "dinheiro", "transferencia", "outro"]),
  amountCents: z.number().int().positive("Informe um valor maior que zero."),
});

export async function registerPaymentAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requireSession();
    const data = paymentSchema.parse(input);
    await registerPayment(ctx, data);
    revalidatePath("/agenda");
    revalidatePath("/hoje");
    revalidatePath("/financeiro");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const createSchema = z.object({
  customerId: z.number().int().positive(),
  serviceId: z.number().int().positive(),
  professionalId: z.number().int().positive(),
  branchId: z.number().int().positive(),
  startsAt: z.string(),
  resourceId: z.number().int().positive().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function createAppointmentAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requireSession();
    const data = createSchema.parse(input);
    await createAppointment(ctx, {
      customerId: data.customerId,
      serviceId: data.serviceId,
      professionalId: data.professionalId,
      branchId: data.branchId,
      startsAt: new Date(data.startsAt),
      resourceId: data.resourceId ?? null,
      notes: data.notes ?? null,
      source: "admin",
    });
    revalidatePath("/agenda");
    revalidatePath("/hoje");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const rescheduleSchema = z.object({
  appointmentId: z.number().int().positive(),
  startsAt: z.string(),
  professionalId: z.number().int().positive().optional(),
});

export async function rescheduleAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requireSession();
    const data = rescheduleSchema.parse(input);
    await rescheduleAppointment(
      ctx,
      data.appointmentId,
      new Date(data.startsAt),
      data.professionalId,
    );
    revalidatePath("/agenda");
    revalidatePath("/hoje");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const slotsSchema = z.object({
  serviceId: z.number().int().positive(),
  dateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  professionalId: z.number().int().positive().optional(),
  branchId: z.number().int().positive().optional(),
});

export type SlotOption = {
  startsAt: string;
  label: string;
  professionalId: number;
  professionalName: string;
  branchId: number;
  resourceId: number | null;
};

/** Consulta de horários usada pelo agendamento rápido — mesma fonte da IA e do público. */
export async function fetchSlotsAction(input: unknown): Promise<SlotOption[]> {
  const ctx = await requireSession();
  const data = slotsSchema.parse(input);
  return listSlots(ctx, data);
}

const rescheduleSlotsSchema = z.object({
  appointmentId: z.number().int().positive(),
  dateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  professionalId: z.number().int().positive().optional(),
});

/**
 * Horários livres para remarcar: o serviço vem do próprio atendimento, então
 * o painel da agenda não precisa carregar serviceId só para essa consulta.
 */
export async function fetchRescheduleSlotsAction(input: unknown): Promise<SlotOption[]> {
  const ctx = await requireSession();
  const data = rescheduleSlotsSchema.parse(input);

  const { db } = await import("@/db");
  const { appointments } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const [row] = await db
    .select({ serviceId: appointments.serviceId })
    .from(appointments)
    .where(
      and(eq(appointments.id, data.appointmentId), eq(appointments.organizationId, ctx.organizationId)),
    )
    .limit(1);
  if (!row) return [];

  return listSlots(ctx, {
    serviceId: row.serviceId,
    dateISO: data.dateISO,
    professionalId: data.professionalId,
  });
}

async function listSlots(
  ctx: Awaited<ReturnType<typeof requireSession>>,
  query: { serviceId: number; dateISO: string; professionalId?: number; branchId?: number },
): Promise<SlotOption[]> {
  const slots = await getAvailableSlots(ctx, query);

  const { formatTz } = await import("@/lib/tz");
  const { db } = await import("@/db");
  const { professionals } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const pros = await db
    .select({ id: professionals.id, name: professionals.name })
    .from(professionals)
    .where(eq(professionals.organizationId, ctx.organizationId));
  const nameById = new Map(pros.map((p) => [p.id, p.name]));

  return slots.map((slot) => ({
    startsAt: slot.start.toISOString(),
    label: formatTz(slot.start, ctx.timezone, "HH:mm"),
    professionalId: slot.professionalId,
    professionalName: nameById.get(slot.professionalId) ?? "",
    branchId: slot.branchId,
    resourceId: slot.resourceId,
  }));
}

export async function searchCustomersAction(query: string) {
  const ctx = await requireSession();
  const { db } = await import("@/db");
  const { customers } = await import("@/db/schema");
  const { and, eq, ilike, or, desc } = await import("drizzle-orm");
  const term = `%${query.trim()}%`;
  return db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      lastVisitAt: customers.lastVisitAt,
    })
    .from(customers)
    .where(
      and(
        eq(customers.organizationId, ctx.organizationId),
        query.trim() ? or(ilike(customers.name, term), ilike(customers.phone, term)) : undefined,
      ),
    )
    .orderBy(desc(customers.lastVisitAt))
    .limit(8);
}
