import "server-only";
import { and, asc, count, desc, eq, gt, ilike, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appointments,
  branches,
  customerTagLinks,
  customerTags,
  customers,
  payments,
  professionals,
  services,
} from "@/db/schema";
import type { TenantContext } from "@/server/auth";

export type CustomerListItem = {
  id: number;
  name: string;
  phone: string | null;
  visitsCount: number;
  totalSpentCents: number;
  lastVisitAt: Date | null;
  nextAppointmentAt: Date | null;
  tags: string[];
};

export type CustomerFilter = "todos" | "retorno" | "novos" | "inativos";

/**
 * Lista de clientes com o contexto que importa para a operação:
 * quanto gastou, quando veio, quando volta. Filtro no servidor, sempre.
 */
export async function listCustomers(
  ctx: TenantContext,
  options: { query?: string; filter?: CustomerFilter; limit?: number } = {},
): Promise<CustomerListItem[]> {
  const { query, filter = "todos", limit = 60 } = options;
  const term = query?.trim() ? `%${query.trim()}%` : null;

  // Próximo atendimento ativo de cada cliente
  const nextAppointment = db
    .select({
      customerId: appointments.customerId,
      nextAt: sql<Date>`min(${appointments.startsAt})`.as("next_at"),
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.organizationId, ctx.organizationId),
        gt(appointments.startsAt, new Date()),
        sql`${appointments.status} in ('scheduled','confirmed','checked_in','in_progress')`,
      ),
    )
    .groupBy(appointments.customerId)
    .as("next_appointment");

  const filters = [eq(customers.organizationId, ctx.organizationId)];
  if (term) {
    filters.push(or(ilike(customers.name, term), ilike(customers.phone, term))!);
  }
  if (filter === "novos") {
    filters.push(sql`${customers.createdAt} > now() - interval '30 days'`);
  }
  if (filter === "retorno") {
    // Já veio, passou do intervalo típico e não tem nada marcado
    filters.push(isNotNull(customers.lastVisitAt));
    filters.push(sql`${customers.lastVisitAt} < now() - interval '45 days'`);
    filters.push(sql`${nextAppointment.nextAt} is null`);
  }
  if (filter === "inativos") {
    filters.push(isNotNull(customers.lastVisitAt));
    filters.push(sql`${customers.lastVisitAt} < now() - interval '120 days'`);
  }

  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      visitsCount: customers.visitsCount,
      totalSpentCents: customers.totalSpentCents,
      lastVisitAt: customers.lastVisitAt,
      nextAppointmentAt: nextAppointment.nextAt,
      tags: sql<string[]>`coalesce(array_agg(distinct ${customerTags.name}) filter (where ${customerTags.name} is not null), '{}')`,
    })
    .from(customers)
    .leftJoin(nextAppointment, eq(nextAppointment.customerId, customers.id))
    .leftJoin(
      customerTagLinks,
      and(
        eq(customerTagLinks.customerId, customers.id),
        eq(customerTagLinks.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(customerTags, eq(customerTags.id, customerTagLinks.tagId))
    .where(and(...filters))
    .groupBy(
      customers.id,
      customers.name,
      customers.phone,
      customers.visitsCount,
      customers.totalSpentCents,
      customers.lastVisitAt,
      nextAppointment.nextAt,
    )
    .orderBy(desc(sql`coalesce(${customers.lastVisitAt}, ${customers.createdAt})`))
    .limit(limit);

  return rows.map((r) => ({ ...r, tags: r.tags ?? [] }));
}

export async function countCustomers(ctx: TenantContext): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(customers)
    .where(eq(customers.organizationId, ctx.organizationId));
  return row?.total ?? 0;
}

export type CustomerProfile = {
  customer: typeof customers.$inferSelect;
  tags: string[];
  nextAppointment: { id: number; startsAt: Date; serviceName: string; professionalName: string } | null;
  ticketAverageCents: number;
};

export async function getCustomer(ctx: TenantContext, customerId: number): Promise<CustomerProfile | null> {
  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, ctx.organizationId)))
    .limit(1);
  if (!customer) return null;

  const [tagRows, upcoming] = await Promise.all([
    db
      .select({ name: customerTags.name })
      .from(customerTagLinks)
      .innerJoin(customerTags, eq(customerTags.id, customerTagLinks.tagId))
      .where(eq(customerTagLinks.customerId, customerId)),
    db
      .select({
        id: appointments.id,
        startsAt: appointments.startsAt,
        serviceName: services.name,
        professionalName: professionals.name,
      })
      .from(appointments)
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .innerJoin(professionals, eq(professionals.id, appointments.professionalId))
      .where(
        and(
          eq(appointments.organizationId, ctx.organizationId),
          eq(appointments.customerId, customerId),
          gt(appointments.startsAt, new Date()),
          sql`${appointments.status} in ('scheduled','confirmed','checked_in','in_progress')`,
        ),
      )
      .orderBy(asc(appointments.startsAt))
      .limit(1),
  ]);

  return {
    customer,
    tags: tagRows.map((t) => t.name),
    nextAppointment: upcoming[0] ?? null,
    ticketAverageCents:
      customer.visitsCount > 0 ? Math.round(customer.totalSpentCents / customer.visitsCount) : 0,
  };
}

export type TimelineEntry = {
  id: string;
  at: Date;
  kind: "appointment" | "payment";
  title: string;
  detail: string;
  status?: string;
  amountCents?: number;
};

/**
 * Timeline única do relacionamento: atendimentos e pagamentos na mesma linha
 * do tempo, porque é assim que a recepção lembra do cliente.
 */
export async function getCustomerTimeline(
  ctx: TenantContext,
  customerId: number,
  limit = 40,
): Promise<TimelineEntry[]> {
  const [appointmentRows, paymentRows] = await Promise.all([
    db
      .select({
        id: appointments.id,
        at: appointments.startsAt,
        status: appointments.status,
        priceCents: appointments.priceCents,
        serviceName: services.name,
        professionalName: professionals.name,
        branchName: branches.name,
        source: appointments.source,
      })
      .from(appointments)
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .innerJoin(professionals, eq(professionals.id, appointments.professionalId))
      .innerJoin(branches, eq(branches.id, appointments.branchId))
      .where(
        and(eq(appointments.organizationId, ctx.organizationId), eq(appointments.customerId, customerId)),
      )
      .orderBy(desc(appointments.startsAt))
      .limit(limit),
    db
      .select({
        id: payments.id,
        at: payments.paidAt,
        amountCents: payments.amountCents,
        method: payments.method,
      })
      .from(payments)
      .where(and(eq(payments.organizationId, ctx.organizationId), eq(payments.customerId, customerId)))
      .orderBy(desc(payments.paidAt))
      .limit(limit),
  ]);

  const METHOD_LABEL: Record<string, string> = {
    pix: "PIX",
    cartao_credito: "cartão de crédito",
    cartao_debito: "cartão de débito",
    dinheiro: "dinheiro",
    transferencia: "transferência",
    outro: "outro meio",
  };

  const entries: TimelineEntry[] = [
    ...appointmentRows.map((a) => ({
      id: `a-${a.id}`,
      at: a.at,
      kind: "appointment" as const,
      title: a.serviceName,
      detail: `${a.professionalName} · ${a.branchName}`,
      status: a.status,
      amountCents: a.priceCents,
    })),
    ...paymentRows.map((p) => ({
      id: `p-${p.id}`,
      at: p.at,
      kind: "payment" as const,
      title: "Pagamento",
      detail: METHOD_LABEL[p.method] ?? p.method,
      amountCents: p.amountCents,
    })),
  ];

  return entries.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

export async function listTags(ctx: TenantContext) {
  return db
    .select({ id: customerTags.id, name: customerTags.name })
    .from(customerTags)
    .where(eq(customerTags.organizationId, ctx.organizationId))
    .orderBy(asc(customerTags.name));
}
