import "server-only";
import { and, desc, eq, gte, inArray, lt, lte, sql, sum } from "drizzle-orm";
import { db } from "@/db";
import {
  appointments,
  commissions,
  customers,
  financialCategories,
  financialTransactions,
  payments,
  professionals,
  services,
} from "@/db/schema";
import { dateISOInTz } from "@/lib/tz";
import type { TenantContext } from "@/server/auth";

/**
 * Financeiro gerencial (não contábil): responde quanto entrou, quanto saiu,
 * quanto ainda entra e quanto ainda sai — e onde está a margem.
 */

export type CashSummary = {
  receivedCents: number;
  paidOutCents: number;
  toReceiveCents: number;
  toPayCents: number;
  overdueInCents: number;
  overdueOutCents: number;
  balanceCents: number;
};

export type Period = { fromISO: string; toISO: string };

export function currentMonth(ctx: TenantContext): Period {
  const today = dateISOInTz(new Date(), ctx.timezone);
  const [year, month] = today.split("-");
  const lastDay = new Date(Number(year), Number(month), 0).getDate();
  return { fromISO: `${year}-${month}-01`, toISO: `${year}-${month}-${String(lastDay).padStart(2, "0")}` };
}

export async function getCashSummary(ctx: TenantContext, period: Period): Promise<CashSummary> {
  const todayISO = dateISOInTz(new Date(), ctx.timezone);

  // Duas agregações em vez de uma com expressão booleana: além de mais legível,
  // evita o mesmo predicado aparecer duas vezes com parâmetros diferentes.
  const [rows, overdueRows] = await Promise.all([
    db
      .select({
        kind: financialTransactions.kind,
        status: financialTransactions.status,
        total: sum(financialTransactions.amountCents).mapWith(Number),
      })
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.organizationId, ctx.organizationId),
          gte(financialTransactions.dueDate, period.fromISO),
          lte(financialTransactions.dueDate, period.toISO),
        ),
      )
      .groupBy(financialTransactions.kind, financialTransactions.status),
    db
      .select({
        kind: financialTransactions.kind,
        total: sum(financialTransactions.amountCents).mapWith(Number),
      })
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.organizationId, ctx.organizationId),
          gte(financialTransactions.dueDate, period.fromISO),
          lt(financialTransactions.dueDate, todayISO),
          inArray(financialTransactions.status, ["pending", "overdue"]),
        ),
      )
      .groupBy(financialTransactions.kind),
  ]);

  const summary: CashSummary = {
    receivedCents: 0,
    paidOutCents: 0,
    toReceiveCents: 0,
    toPayCents: 0,
    overdueInCents: 0,
    overdueOutCents: 0,
    balanceCents: 0,
  };

  for (const row of rows) {
    const value = row.total ?? 0;
    if (row.status === "cancelled") continue;
    const settled = row.status === "paid";
    if (row.kind === "income") {
      if (settled) summary.receivedCents += value;
      else summary.toReceiveCents += value;
    } else {
      if (settled) summary.paidOutCents += value;
      else summary.toPayCents += value;
    }
  }

  for (const row of overdueRows) {
    const value = row.total ?? 0;
    if (row.kind === "income") summary.overdueInCents += value;
    else summary.overdueOutCents += value;
  }

  summary.balanceCents = summary.receivedCents - summary.paidOutCents;
  return summary;
}

export type TransactionRow = {
  id: number;
  kind: "income" | "expense";
  status: string;
  description: string;
  amountCents: number;
  dueDate: string;
  paidAt: Date | null;
  categoryName: string | null;
  customerName: string | null;
  /**
   * Serviço do atendimento que gerou o lançamento, quando houve um.
   *
   * A receita nascida de atendimento entra com `description = "Atendimento"`,
   * literalmente igual em todas as linhas. Sem esta coluna a lista de
   * lançamentos do mês vira uma pilha de "Atendimento / Atendimento /
   * Atendimento" e o dono precisa abrir cada uma para saber do que se trata.
   */
  serviceName: string | null;
};

export async function listTransactions(
  ctx: TenantContext,
  period: Period,
  filter: "todos" | "entradas" | "saidas" | "em_aberto" = "todos",
): Promise<TransactionRow[]> {
  const conditions = [
    eq(financialTransactions.organizationId, ctx.organizationId),
    gte(financialTransactions.dueDate, period.fromISO),
    lte(financialTransactions.dueDate, period.toISO),
  ];
  if (filter === "entradas") conditions.push(eq(financialTransactions.kind, "income"));
  if (filter === "saidas") conditions.push(eq(financialTransactions.kind, "expense"));
  if (filter === "em_aberto")
    conditions.push(inArray(financialTransactions.status, ["pending", "overdue"]));

  return db
    .select({
      id: financialTransactions.id,
      kind: financialTransactions.kind,
      status: financialTransactions.status,
      description: financialTransactions.description,
      amountCents: financialTransactions.amountCents,
      dueDate: financialTransactions.dueDate,
      paidAt: financialTransactions.paidAt,
      categoryName: financialCategories.name,
      customerName: customers.name,
      serviceName: services.name,
    })
    .from(financialTransactions)
    .leftJoin(financialCategories, eq(financialCategories.id, financialTransactions.categoryId))
    .leftJoin(customers, eq(customers.id, financialTransactions.customerId))
    // Os dois `leftJoin` são encadeados e não uma subconsulta porque
    // `appointment_id` já é indexado e a lista para em 200 linhas.
    .leftJoin(
      appointments,
      and(
        eq(appointments.id, financialTransactions.appointmentId),
        // Redundante pela chave estrangeira, e mantido de propósito: filtro de
        // conta em TODA junção é o que impede que um id trocado por engano
        // atravesse a fronteira entre contas.
        eq(appointments.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      services,
      and(eq(services.id, appointments.serviceId), eq(services.organizationId, ctx.organizationId)),
    )
    .where(and(...conditions))
    .orderBy(desc(financialTransactions.dueDate), desc(financialTransactions.id))
    .limit(200);
}

export type ManagementResult = {
  revenueCents: number;
  variableCostCents: number;
  commissionCents: number;
  contributionMarginCents: number;
  expensesCents: number;
  operatingResultCents: number;
};

/** DRE gerencial: receita − custos variáveis − comissão = margem; − despesas = resultado. */
export async function getManagementResult(
  ctx: TenantContext,
  period: Period,
): Promise<ManagementResult> {
  const from = new Date(`${period.fromISO}T00:00:00Z`);
  const to = new Date(`${period.toISO}T23:59:59Z`);

  const [[revenue], [costs], [commissionTotal], [expenses]] = await Promise.all([
    db
      .select({ total: sum(payments.amountCents).mapWith(Number) })
      .from(payments)
      .where(
        and(
          eq(payments.organizationId, ctx.organizationId),
          gte(payments.paidAt, from),
          lte(payments.paidAt, to),
        ),
      ),
    db
      .select({ total: sum(services.costCents).mapWith(Number) })
      .from(appointments)
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .where(
        and(
          eq(appointments.organizationId, ctx.organizationId),
          eq(appointments.status, "completed"),
          gte(appointments.startsAt, from),
          lte(appointments.startsAt, to),
        ),
      ),
    // A comissão pertence ao mês do ATENDIMENTO, não ao momento em que a
    // conclusão foi registrada — uma baixa lançada com atraso não muda o mês.
    db
      .select({ total: sum(commissions.amountCents).mapWith(Number) })
      .from(commissions)
      .innerJoin(appointments, eq(appointments.id, commissions.appointmentId))
      .where(
        and(
          eq(commissions.organizationId, ctx.organizationId),
          gte(appointments.startsAt, from),
          lte(appointments.startsAt, to),
        ),
      ),
    db
      .select({ total: sum(financialTransactions.amountCents).mapWith(Number) })
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.organizationId, ctx.organizationId),
          eq(financialTransactions.kind, "expense"),
          eq(financialTransactions.status, "paid"),
          gte(financialTransactions.dueDate, period.fromISO),
          lte(financialTransactions.dueDate, period.toISO),
        ),
      ),
  ]);

  const revenueCents = revenue?.total ?? 0;
  const variableCostCents = costs?.total ?? 0;
  const commissionCents = commissionTotal?.total ?? 0;
  const expensesCents = expenses?.total ?? 0;
  const contributionMarginCents = revenueCents - variableCostCents - commissionCents;

  return {
    revenueCents,
    variableCostCents,
    commissionCents,
    contributionMarginCents,
    expensesCents,
    operatingResultCents: contributionMarginCents - expensesCents,
  };
}

/** Receita por serviço — responde "o que sustenta o faturamento". */
export async function getRevenueByService(ctx: TenantContext, period: Period) {
  const from = new Date(`${period.fromISO}T00:00:00Z`);
  const to = new Date(`${period.toISO}T23:59:59Z`);

  return db
    .select({
      name: services.name,
      total: sum(payments.amountCents).mapWith(Number),
      count: sql<number>`count(distinct ${appointments.id})`.mapWith(Number),
    })
    .from(payments)
    .innerJoin(appointments, eq(appointments.id, payments.appointmentId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .where(
      and(
        eq(payments.organizationId, ctx.organizationId),
        gte(payments.paidAt, from),
        lte(payments.paidAt, to),
      ),
    )
    .groupBy(services.name)
    .orderBy(desc(sum(payments.amountCents)))
    .limit(8);
}

/** Comissões a acertar com cada profissional no período. */
export async function getCommissionsByProfessional(ctx: TenantContext, period: Period) {
  const from = new Date(`${period.fromISO}T00:00:00Z`);
  const to = new Date(`${period.toISO}T23:59:59Z`);

  return db
    .select({
      name: professionals.name,
      color: professionals.color,
      total: sum(commissions.amountCents).mapWith(Number),
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(commissions)
    .innerJoin(professionals, eq(professionals.id, commissions.professionalId))
    .innerJoin(appointments, eq(appointments.id, commissions.appointmentId))
    .where(
      and(
        eq(commissions.organizationId, ctx.organizationId),
        gte(appointments.startsAt, from),
        lte(appointments.startsAt, to),
      ),
    )
    .groupBy(professionals.name, professionals.color)
    .orderBy(desc(sum(commissions.amountCents)));
}
