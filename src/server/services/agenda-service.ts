import "server-only";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import {
  appointments,
  branches,
  customers,
  payments,
  professionalWorkingHours,
  professionals,
  services,
} from "@/db/schema";
import { dayRangeInTz, weekdayInTz } from "@/lib/tz";
import type { TenantContext } from "@/server/auth";
import type { TodayAppointment } from "./today-service";
import { sql, sum } from "drizzle-orm";

export type AgendaColumn = {
  professionalId: number;
  name: string;
  color: string;
  /** minutos desde 00:00 no fuso do tenant */
  workStart: number | null;
  workEnd: number | null;
};

export type AgendaDay = {
  appointments: TodayAppointment[];
  columns: AgendaColumn[];
  /** limites da grade renderizada, em minutos desde 00:00 */
  gridStart: number;
  gridEnd: number;
};

/** Atendimentos de um intervalo local, usados nas visões semanal e mensal. */
export async function getAgendaRange(
  ctx: TenantContext,
  rangeStart: Date,
  rangeEnd: Date,
  branchId?: number,
): Promise<TodayAppointment[]> {
  const { start } = dayRangeInTz(rangeStart, ctx.timezone);
  const { end } = dayRangeInTz(rangeEnd, ctx.timezone);
  const paidByAppointment = db
    .select({
      appointmentId: payments.appointmentId,
      paid: sum(payments.amountCents).mapWith(Number).as("paid"),
    })
    .from(payments)
    .where(eq(payments.organizationId, ctx.organizationId))
    .groupBy(payments.appointmentId)
    .as("range_paid_by_appointment");

  return db
    .select({
      id: appointments.id,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      status: appointments.status,
      priceCents: appointments.priceCents,
      source: appointments.source,
      customerId: customers.id,
      customerName: customers.name,
      customerPhone: customers.phone,
      serviceName: services.name,
      professionalId: professionals.id,
      professionalName: professionals.name,
      professionalColor: professionals.color,
      branchName: branches.name,
      paidCents: sql<number>`coalesce(${paidByAppointment.paid}, 0)`.mapWith(Number),
    })
    .from(appointments)
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(professionals, eq(professionals.id, appointments.professionalId))
    .innerJoin(branches, eq(branches.id, appointments.branchId))
    .leftJoin(paidByAppointment, eq(paidByAppointment.appointmentId, appointments.id))
    .where(
      and(
        eq(appointments.organizationId, ctx.organizationId),
        gte(appointments.startsAt, start),
        lt(appointments.startsAt, end),
        branchId ? eq(appointments.branchId, branchId) : undefined,
      ),
    )
    .orderBy(asc(appointments.startsAt));
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":");
  return Number(h) * 60 + Number(m);
}

export async function getAgendaDay(
  ctx: TenantContext,
  day: Date,
  branchId?: number,
): Promise<AgendaDay> {
  const { start, end } = dayRangeInTz(day, ctx.timezone);
  const weekday = weekdayInTz(start, ctx.timezone);

  const paidByAppointment = db
    .select({
      appointmentId: payments.appointmentId,
      paid: sum(payments.amountCents).mapWith(Number).as("paid"),
    })
    .from(payments)
    .where(eq(payments.organizationId, ctx.organizationId))
    .groupBy(payments.appointmentId)
    .as("paid_by_appointment");

  const [rows, hours, pros] = await Promise.all([
    db
      .select({
        id: appointments.id,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        status: appointments.status,
        priceCents: appointments.priceCents,
        source: appointments.source,
        customerId: customers.id,
        customerName: customers.name,
        customerPhone: customers.phone,
        serviceName: services.name,
        professionalId: professionals.id,
        professionalName: professionals.name,
        professionalColor: professionals.color,
        branchName: branches.name,
        paidCents: sql<number>`coalesce(${paidByAppointment.paid}, 0)`.mapWith(Number),
      })
      .from(appointments)
      .innerJoin(customers, eq(customers.id, appointments.customerId))
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .innerJoin(professionals, eq(professionals.id, appointments.professionalId))
      .innerJoin(branches, eq(branches.id, appointments.branchId))
      .leftJoin(paidByAppointment, eq(paidByAppointment.appointmentId, appointments.id))
      .where(
        and(
          eq(appointments.organizationId, ctx.organizationId),
          gte(appointments.startsAt, start),
          lt(appointments.startsAt, end),
          branchId ? eq(appointments.branchId, branchId) : undefined,
        ),
      )
      .orderBy(asc(appointments.startsAt)),
    db
      .select()
      .from(professionalWorkingHours)
      .where(
        and(
          eq(professionalWorkingHours.organizationId, ctx.organizationId),
          eq(professionalWorkingHours.weekday, weekday),
          branchId ? eq(professionalWorkingHours.branchId, branchId) : undefined,
        ),
      ),
    db
      .select({ id: professionals.id, name: professionals.name, color: professionals.color })
      .from(professionals)
      .where(and(eq(professionals.organizationId, ctx.organizationId), eq(professionals.active, true)))
      .orderBy(asc(professionals.name)),
  ]);

  // Colunas: quem trabalha hoje + quem tem atendimento hoje (mesmo fora da grade)
  const workingIds = new Set(hours.map((h) => h.professionalId));
  const scheduledIds = new Set(rows.map((r) => r.professionalId));
  const columns: AgendaColumn[] = pros
    .filter((p) => workingIds.has(p.id) || scheduledIds.has(p.id))
    .map((p) => {
      const own = hours.filter((h) => h.professionalId === p.id);
      return {
        professionalId: p.id,
        name: p.name,
        color: p.color,
        workStart: own.length ? Math.min(...own.map((h) => minutesOf(h.startTime))) : null,
        workEnd: own.length ? Math.max(...own.map((h) => minutesOf(h.endTime))) : null,
      };
    });

  // A grade cobre a jornada + qualquer atendimento fora dela
  const candidatesStart = [
    ...columns.map((c) => c.workStart).filter((v): v is number => v !== null),
    ...rows.map((r) => minutesFromDayStart(r.startsAt, start)),
  ];
  const candidatesEnd = [
    ...columns.map((c) => c.workEnd).filter((v): v is number => v !== null),
    ...rows.map((r) => minutesFromDayStart(r.endsAt, start)),
  ];

  const gridStart = candidatesStart.length ? Math.floor(Math.min(...candidatesStart) / 60) * 60 : 8 * 60;
  const gridEnd = candidatesEnd.length ? Math.ceil(Math.max(...candidatesEnd) / 60) * 60 : 19 * 60;

  return { appointments: rows, columns, gridStart, gridEnd };
}

export function minutesFromDayStart(date: Date, dayStartUtc: Date): number {
  return Math.round((date.getTime() - dayStartUtc.getTime()) / 60000);
}

/** Dados de apoio para criar/editar atendimento sem sair da agenda. */
export async function getAgendaFormData(ctx: TenantContext) {
  const [serviceRows, professionalRows, branchRows] = await Promise.all([
    db
      .select({
        id: services.id,
        name: services.name,
        durationMin: services.durationMin,
        priceCents: services.priceCents,
      })
      .from(services)
      .where(and(eq(services.organizationId, ctx.organizationId), eq(services.active, true)))
      .orderBy(asc(services.name)),
    db
      .select({ id: professionals.id, name: professionals.name, color: professionals.color })
      .from(professionals)
      .where(and(eq(professionals.organizationId, ctx.organizationId), eq(professionals.active, true)))
      .orderBy(asc(professionals.name)),
    db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(and(eq(branches.organizationId, ctx.organizationId), eq(branches.active, true)))
      .orderBy(asc(branches.name)),
  ]);
  return { services: serviceRows, professionals: professionalRows, branches: branchRows };
}
