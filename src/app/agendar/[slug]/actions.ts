"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bookingPageVisits, organizations } from "@/db/schema";
import { normalizePhone } from "@/lib/phone";
import { dateISOInTz, formatTz } from "@/lib/tz";
import { DomainError } from "@/server/services/appointment-service";
import { clientIp } from "@/server/services/signup";
import { permitirAgendamento, permitirConsulta, permitirVisita } from "./rate-limit";
import {
  type PublicSlot,
  createPublicBooking,
  getPublicAvailableDays,
  getPublicOrganization,
  getPublicSlots,
} from "@/server/services/public-booking-service";

/**
 * Chave do limitador: endereço + agenda.
 *
 * Por agenda, e não só por endereço, para que um visitante insistente numa
 * clínica não consiga fechar a consulta de disponibilidade das outras — o mesmo
 * raciocínio que `permitirVisita` já usava.
 */
async function chaveDeVazao(slug: string): Promise<string> {
  return `${clientIp(await headers())}:${slug}`;
}

/** Erro que a tela mostra quando o freio pega. Neutro: não é culpa da cliente. */
const MUITAS_TENTATIVAS =
  "Muitas consultas em pouco tempo. Aguarde alguns segundos e tente de novo.";

const slotsSchema = z.object({
  slug: z.string().min(1),
  serviceId: z.number().int().positive(),
  dateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  professionalId: z.number().int().positive().optional(),
  branchId: z.number().int().positive().optional(),
});

export async function publicSlotsAction(input: unknown): Promise<PublicSlot[]> {
  const data = slotsSchema.parse(input);
  // Seis consultas ao banco por chamada, sem sessão e sem custo para quem
  // chama. Ver o comentário do teto em ./rate-limit.
  if (!permitirConsulta(await chaveDeVazao(data.slug))) return [];
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
  // A mais cara das três: uma varredura de disponibilidade POR DATA, até 31.
  if (!permitirConsulta(await chaveDeVazao(data.slug))) return [];
  return getPublicAvailableDays(data.slug, data);
}

/**
 * Registra uma visita anônima por navegador/dia; não guarda IP nem dados da cliente.
 *
 * O limite vem ANTES da consulta da conta, e a chave é `ip:slug` (e não o id da
 * conta) exatamente por isso: descobrir o id custaria a consulta que o limite
 * existe para evitar, e varrer slugs à procura de agendas que existem seria
 * outro uso indevido que a chave por slug já segura. O IP fica só na contagem
 * em memória — a linha gravada continua sem ele.
 */
export async function trackBookingAccessAction(input: unknown): Promise<void> {
  const data = z.object({
    slug: z.string().min(1).max(120),
    visitorToken: z.string().uuid(),
  }).parse(input);
  const ip = clientIp(await headers());
  if (!permitirVisita(`${ip}:${data.slug}`)) return;
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

  if (!permitirAgendamento(await chaveDeVazao(parsed.data.slug))) {
    return { ok: false, error: MUITAS_TENTATIVAS };
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
