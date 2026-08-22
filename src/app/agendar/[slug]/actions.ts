"use server";

import { z } from "zod";
import { normalizePhone } from "@/lib/phone";
import { formatTz } from "@/lib/tz";
import { DomainError } from "@/server/services/appointment-service";
import {
  type PublicSlot,
  createPublicBooking,
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
});

export type BookingConfirmation = {
  serviceName: string;
  professionalName: string;
  branchName: string;
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
    });

    return {
      ok: true,
      confirmation: {
        serviceName: result.serviceName,
        professionalName: result.professionalName,
        branchName: result.branchName,
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
