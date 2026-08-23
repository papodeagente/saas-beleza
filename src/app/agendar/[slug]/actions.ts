"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bookingPageVisits, organizations } from "@/db/schema";
import { normalizePhone } from "@/lib/phone";
import { dateISOInTz, formatTz } from "@/lib/tz";
import { DomainError } from "@/server/services/appointment-service";
import {
  type PublicSlot,
  createPublicBooking,
  getPublicAvailableDays,
  getPublicOrganization,
  getPublicSlots,
} from "@/server/services/public-booking-service";

const slotsSchema = z.object({
  slug: z.string().min(1),
  serviceId: z.number().int().positive(),
  dateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  professionalId: z.number().int().positive().optional(),
  branchId: z.number().int().positive().optional(),
});

export async function publicSlotsAction(input: unknown): Promise<PublicSlot[]> {
  const data = slotsSchema.parse(input);
  return getPublicSlots(data.slug, {
    serviceId: data.serviceId,
    dateISO: data.dateISO,
    professionalId: data.professionalId,
    branchId: data.branchId,
  });
}

const daysSchema = z.object({
  slug: z.string().min(1),
  serviceId: z.number().int().positive(),
  dateISOs: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(31),
  branchId: z.number().int().positive().optional(),
});

export async function publicAvailableDaysAction(input: unknown) {
  const data = daysSchema.parse(input);
  return getPublicAvailableDays(data.slug, data);
}

/** Registra uma visita anônima por navegador/dia; não guarda IP nem dados da cliente. */
export async function trackBookingAccessAction(input: unknown): Promise<void> {
  const data = z.object({
    slug: z.string().min(1).max(120),
    visitorToken: z.string().uuid(),
  }).parse(input);
  const [org] = await db.select({ id: organizations.id, timezone: organizations.timezone })
    .from(organizations).where(eq(organizations.slug, data.slug)).limit(1);
  if (!org) return;
  await db.insert(bookingPageVisits).values({
    organizationId: org.id,
    visitorToken: data.visitorToken,
    visitDate: dateISOInTz(new Date(), org.timezone),
  }).onConflictDoNothing({
    target: [bookingPageVisits.organizationId, bookingPageVisits.visitorToken, bookingPageVisits.visitDate],
  });
}

const bookingSchema = z.object({
  slug: z.string().min(1),
  serviceId: z.number().int().positive(),
  startsAt: z.string(),
  professionalId: z.number().int().positive(),
  branchId: z.number().int().positive(),
  resourceId: z.number().int().positive().nullable(),
  name: z.string().trim().min(2, "Informe seu nome completo."),
  phone: z
    .string()
    .transform(normalizePhone)
    .refine((v) => v.length >= 10 && v.length <= 13, "Informe um celular com DDD."),
  email: z.string().trim().email("E-mail inválido.").optional().or(z.literal("")),
  /** Opt-in de comunicação. Opcional e desmarcado por padrão — o agendamento não depende dele. */
  consentMarketing: z.boolean().optional(),
});

export type BookingConfirmation = {
  serviceName: string;
  professionalName: string;
  branchName: string;
  branchAddress: string | null;
  whenLabel: string;
};

export type BookingActionResult =
  | { ok: true; confirmation: BookingConfirmation }
  | { ok: false; error: string };

export async function publicBookingAction(input: unknown): Promise<BookingActionResult> {
  const parsed = bookingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  try {
    const org = await getPublicOrganization(parsed.data.slug);
    if (!org) return { ok: false, error: "Esta clínica não está mais recebendo agendamentos online." };

    const result = await createPublicBooking({
      ...parsed.data,
      email: parsed.data.email || null,
      consentMarketing: parsed.data.consentMarketing === true,
    });

    return {
      ok: true,
      confirmation: {
        serviceName: result.serviceName,
        professionalName: result.professionalName,
        branchName: result.branchName,
        branchAddress: result.branchAddress,
        whenLabel: formatTz(
          result.startsAt,
          org.organization.timezone,
          "EEEE, d 'de' MMMM 'às' HH:mm",
        ),
      },
    };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    console.error(error);
    return {
      ok: false,
      error: "Não conseguimos concluir o agendamento agora. Tente novamente em instantes.",
    };
  }
}
