import "server-only";
import { and, asc, count, eq, gte, inArray, lt, lte, ne, sql, sum } from "drizzle-orm";
import { db } from "@/db";
import {
  appointments,
  branches,
  customers,
  financialTransactions,
  payments,
  professionals,
  services,
} from "@/db/schema";
import { dateISOInTz, dayRangeInTz } from "@/lib/tz";
import type { TenantContext } from "@/server/auth";

export type TodayAppointment = {
  id: number;
  startsAt: Date;
  endsAt: Date;
  status: string;
  priceCents: number;
  source: string;
  customerId: number;
  customerName: string;
  customerPhone: string | null;
  serviceName: string;
  professionalId: number;
  professionalName: string;
  professionalColor: string;
  branchName: string;
  paidCents: number;
};

export async function getTodayAppointments(ctx: TenantContext, day = new Date()): Promise<TodayAppointment[]> {
  const { start, end } = dayRangeInTz(day, ctx.timezone);

  const paidByAppointment = db
    .select({
      appointmentId: payments.appointmentId,
      paid: sum(payments.amountCents).mapWith(Number).as("paid"),
    })
    .from(payments)
    .where(eq(payments.organizationId, ctx.organizationId))
    .groupBy(payments.appointmentId)
    .as("paid_by_appointment");

  const rows = await db
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
      ),
    )
    .orderBy(asc(appointments.startsAt));

  return rows;
}

export type TodaySummary = {
  total: number;
  confirmed: number;
  awaitingConfirmation: number;
  completed: number;
  cancelled: number;
  expectedRevenueCents: number;
  receivedCents: number;
};

export function summarize(list: TodayAppointment[]): TodaySummary {
  const active = list.filter((a) => a.status !== "cancelled" && a.status !== "no_show");
  return {
    total: active.length,
    confirmed: list.filter((a) => ["confirmed", "checked_in", "in_progress", "completed"].includes(a.status)).length,
    awaitingConfirmation: list.filter((a) => a.status === "scheduled").length,
    completed: list.filter((a) => a.status === "completed").length,
    cancelled: list.filter((a) => a.status === "cancelled" || a.status === "no_show").length,
    expectedRevenueCents: active.reduce((sum, a) => sum + a.priceCents, 0),
    receivedCents: list.reduce((sum, a) => sum + a.paidCents, 0),
  };
}

export type AttentionItem = {
  id: string;
  label: string;
  detail?: string;
  tone: "attention" | "danger" | "info";
  href: string;
  actionLabel: string;
};

/**
 * "Precisa da sua atenção" — só entra o que tem ação possível hoje.
 * Nada de métrica decorativa.
 */
export async function getAttentionItems(ctx: TenantContext, today: TodayAppointment[]): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];
  const todayISO = dateISOInTz(new Date(), ctx.timezone);
  const { start: tomorrowStart, end: tomorrowEnd } = dayRangeInTz(
    new Date(Date.now() + 86_400_000),
    ctx.timezone,
  );

  // Vocabulário: o produto não tem canal de confirmação (nada é enviado ao
  // cliente). O que existe é o registro do status — e é isso que o texto diz.
  const unconfirmedToday = today.filter((a) => a.status === "scheduled");
  if (unconfirmedToday.length > 0) {
    items.push({
      id: "unconfirmed-today",
      label: `${unconfirmedToday.length} ${unconfirmedToday.length === 1 ? "atendimento de hoje sem confirmação registrada" : "atendimentos de hoje sem confirmação registrada"}`,
      detail: unconfirmedToday.map((a) => a.customerName).slice(0, 3).join(", "),
      tone: "attention",
      href: unconfirmedToday.length === 1 ? `/agenda?atendimento=${unconfirmedToday[0].id}` : "/agenda",
      actionLabel: "Marcar como confirmado",
    });
  }

  const [tomorrowUnconfirmed] = await db
    .select({ total: count() })
    .from(appointments)
    .where(
      and(
        eq(appointments.organizationId, ctx.organizationId),
        eq(appointments.status, "scheduled"),
        gte(appointments.startsAt, tomorrowStart),
        lt(appointments.startsAt, tomorrowEnd),
      ),
    );
  if (tomorrowUnconfirmed.total > 0) {
    items.push({
      id: "unconfirmed-tomorrow",
      label: `${tomorrowUnconfirmed.total} ${tomorrowUnconfirmed.total === 1 ? "atendimento de amanhã sem confirmação registrada" : "atendimentos de amanhã sem confirmação registrada"}`,
      tone: "info",
      href: "/agenda?dia=amanha",
      actionLabel: "Ver amanhã",
    });
  }

  const unpaidCompleted = today.filter((a) => a.status === "completed" && a.paidCents < a.priceCents);
  if (unpaidCompleted.length > 0) {
    items.push({
      id: "unpaid",
      label: `${unpaidCompleted.length} ${unpaidCompleted.length === 1 ? "atendimento concluído sem pagamento registrado" : "atendimentos concluídos sem pagamento registrado"}`,
      detail: unpaidCompleted.map((a) => a.customerName).slice(0, 3).join(", "),
      tone: "danger",
      href: unpaidCompleted.length === 1 ? `/agenda?atendimento=${unpaidCompleted[0].id}` : "/agenda",
      actionLabel: "Registrar pagamento",
    });
  }

  const [overdue] = await db
    .select({ total: count(), amount: sum(financialTransactions.amountCents).mapWith(Number) })
    .from(financialTransactions)
    .where(
      and(
        eq(financialTransactions.organizationId, ctx.organizationId),
        inArray(financialTransactions.status, ["pending", "overdue"]),
        lte(financialTransactions.dueDate, todayISO),
      ),
    );
  if (overdue.total > 0) {
    items.push({
      id: "overdue",
      label: `${overdue.total} ${overdue.total === 1 ? "conta venceu" : "contas venceram"} e continua${overdue.total === 1 ? "" : "m"} em aberto`,
      tone: "danger",
      href: "/financeiro",
      actionLabel: "Ver contas em aberto",
    });
  }

  return items;
}

/**
 * Pendências do dia para o shell (sino de avisos).
 * Mesma fonte da tela "Hoje" — um sinal nunca aparece num lugar e some no outro.
 */
export async function getAttentionSignals(ctx: TenantContext): Promise<AttentionItem[]> {
  return getAttentionItems(ctx, await getTodayAppointments(ctx));
}

/** Sinal de retenção: clientes no período ideal de retorno que ainda não voltaram. */
export async function getReturnDueCount(ctx: TenantContext): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(customers)
    .where(
      and(
        eq(customers.organizationId, ctx.organizationId),
        sql`${customers.lastVisitAt} is not null`,
        sql`${customers.lastVisitAt} < now() - interval '45 days'`,
        ne(customers.visitsCount, 0),
      ),
    );
  return row?.total ?? 0;
}
