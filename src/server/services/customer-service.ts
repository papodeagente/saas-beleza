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

export type CustomerAppointment = {
  id: number;
  startsAt: Date;
  endsAt: Date;
  status: string;
  priceCents: number;
  paidCents: number;
  serviceName: string;
  professionalName: string;
  professionalColor: string;
  branchName: string;
  source: string;
};

/**
 * Atendimentos separados por tempo, não misturados.
 * "Histórico" que contém o atendimento de amanhã é histórico errado.
 */
export async function getCustomerAppointments(
  ctx: TenantContext,
  customerId: number,
): Promise<{ upcoming: CustomerAppointment[]; past: CustomerAppointment[] }> {
  const paidByAppointment = db
    .select({
      appointmentId: payments.appointmentId,
      paid: sql<number>`sum(${payments.amountCents})`.mapWith(Number).as("paid"),
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
      paidCents: sql<number>`coalesce(${paidByAppointment.paid}, 0)`.mapWith(Number),
      serviceName: services.name,
      professionalName: professionals.name,
      professionalColor: professionals.color,
      branchName: branches.name,
      source: appointments.source,
    })
    .from(appointments)
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(professionals, eq(professionals.id, appointments.professionalId))
    .innerJoin(branches, eq(branches.id, appointments.branchId))
    .leftJoin(paidByAppointment, eq(paidByAppointment.appointmentId, appointments.id))
    .where(
      and(eq(appointments.organizationId, ctx.organizationId), eq(appointments.customerId, customerId)),
    )
    .orderBy(desc(appointments.startsAt))
    .limit(120);

  const now = Date.now();
  const isOpen = (status: string) =>
    ["scheduled", "confirmed", "checked_in", "in_progress"].includes(status);

  return {
    upcoming: rows
      .filter((r) => r.startsAt.getTime() >= now && isOpen(r.status))
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    past: rows.filter((r) => !(r.startsAt.getTime() >= now && isOpen(r.status))),
  };
}

export type CustomerPayment = {
  id: number;
  paidAt: Date;
  amountCents: number;
  method: string;
  serviceName: string | null;
};

export async function getCustomerPayments(
  ctx: TenantContext,
  customerId: number,
): Promise<CustomerPayment[]> {
  return db
    .select({
      id: payments.id,
      paidAt: payments.paidAt,
      amountCents: payments.amountCents,
      method: payments.method,
      serviceName: services.name,
    })
    .from(payments)
    .leftJoin(appointments, eq(appointments.id, payments.appointmentId))
    .leftJoin(services, eq(services.id, appointments.serviceId))
    .where(and(eq(payments.organizationId, ctx.organizationId), eq(payments.customerId, customerId)))
    .orderBy(desc(payments.paidAt))
    .limit(60);
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

export class CustomerError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

export type CustomerInput = {
  name: string;
  phone: string | null;
  email: string | null;
  birthdate: string | null;
  notes: string | null;
  preferredProfessionalId: number | null;
  preferredBranchId: number | null;
  consentMarketing: boolean;
};

/** O índice único é parcial em (organization_id, phone) — o driver devolve 23505. */
function isDuplicatePhone(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    const { code, constraint } = current as { code?: string; constraint?: string };
    if (code === "23505" && (constraint ?? "").includes("customers_org_phone")) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export async function createCustomer(ctx: TenantContext, input: CustomerInput) {
  try {
    const [created] = await db
      .insert(customers)
      .values({
        organizationId: ctx.organizationId,
        name: input.name.trim(),
        phone: input.phone,
        email: input.email,
        birthdate: input.birthdate,
        notes: input.notes,
        preferredProfessionalId: input.preferredProfessionalId,
        preferredBranchId: input.preferredBranchId,
        consentMarketing: input.consentMarketing,
        source: "manual",
      })
      .returning();
    return created;
  } catch (error) {
    if (isDuplicatePhone(error))
      throw new CustomerError("Já existe um cliente com esse telefone.", "DUPLICATE_PHONE", "phone");
    throw error;
  }
}

export async function updateCustomer(ctx: TenantContext, customerId: number, input: CustomerInput) {
  try {
    const [updated] = await db
      .update(customers)
      .set({
        name: input.name.trim(),
        phone: input.phone,
        email: input.email,
        birthdate: input.birthdate,
        notes: input.notes,
        preferredProfessionalId: input.preferredProfessionalId,
        preferredBranchId: input.preferredBranchId,
        consentMarketing: input.consentMarketing,
      })
      .where(and(eq(customers.id, customerId), eq(customers.organizationId, ctx.organizationId)))
      .returning();
    if (!updated) throw new CustomerError("Cliente não encontrado.", "NOT_FOUND");
    return updated;
  } catch (error) {
    if (isDuplicatePhone(error))
      throw new CustomerError("Já existe um cliente com esse telefone.", "DUPLICATE_PHONE", "phone");
    throw error;
  }
}

/** Opções de preferência para o formulário de cliente. */
export async function getCustomerFormOptions(ctx: TenantContext) {
  const [professionalRows, branchRows] = await Promise.all([
    db
      .select({ id: professionals.id, name: professionals.name })
      .from(professionals)
      .where(and(eq(professionals.organizationId, ctx.organizationId), eq(professionals.active, true)))
      .orderBy(asc(professionals.name)),
    db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(and(eq(branches.organizationId, ctx.organizationId), eq(branches.active, true)))
      .orderBy(asc(branches.name)),
  ]);
  return { professionals: professionalRows, branches: branchRows };
}

export async function listTags(ctx: TenantContext) {
  return db
    .select({ id: customerTags.id, name: customerTags.name })
    .from(customerTags)
    .where(eq(customerTags.organizationId, ctx.organizationId))
    .orderBy(asc(customerTags.name));
}
