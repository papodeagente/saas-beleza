import "server-only";
import { addMinutes } from "date-fns";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appointmentHistory,
  appointments,
  commissions,
  customers,
  domainEvents,
  financialTransactions,
  payments,
  professionalServices,
  professionals,
  services,
} from "@/db/schema";
import { dateISOInTz } from "@/lib/tz";
import {
  type AppointmentStatus,
  STATUS_LABEL,
  TRANSITIONS,
} from "@/domain/appointment-status";
import type { TenantContext } from "@/server/auth";
import { dispatchAppointmentCreatedAutomations } from "./automation-service";

export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

const SLOT_TAKEN = "Esse horário acabou de ser ocupado. Escolha outro horário disponível.";

/**
 * O drizzle embrulha o erro do driver, então o código do Postgres fica em
 * `cause` — percorrer a cadeia é o que faz o usuário ver "esse horário acabou
 * de ser ocupado" em vez de uma falha genérica.
 */
function isOverlapViolation(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    const { code, constraint } = current as { code?: string; constraint?: string };
    if (code === "23P01") return true;
    if (constraint?.includes("no_professional_overlap") || constraint?.includes("no_resource_overlap"))
      return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export type CreateAppointmentInput = {
  customerId: number;
  serviceId: number;
  professionalId: number;
  branchId: number;
  startsAt: Date;
  resourceId?: number | null;
  notes?: string | null;
  source?: "admin" | "public" | "whatsapp" | "ai";
  conversationId?: number | null;
};

export async function createAppointment(ctx: TenantContext, input: CreateAppointmentInput) {
  const [service] = await db
    .select()
    .from(services)
    .where(and(eq(services.id, input.serviceId), eq(services.organizationId, ctx.organizationId)))
    .limit(1);
  if (!service) throw new DomainError("Serviço não encontrado.", "SERVICE_NOT_FOUND");

  // O cliente precisa ser do mesmo tenant (proteção IDOR)
  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.organizationId, ctx.organizationId)))
    .limit(1);
  if (!customer) throw new DomainError("Cliente não encontrado.", "CUSTOMER_NOT_FOUND");

  const endsAt = addMinutes(input.startsAt, service.durationMin);

  try {
    const created = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(appointments)
        .values({
          organizationId: ctx.organizationId,
          branchId: input.branchId,
          customerId: input.customerId,
          professionalId: input.professionalId,
          serviceId: input.serviceId,
          resourceId: input.resourceId ?? null,
          startsAt: input.startsAt,
          endsAt,
          priceCents: service.priceCents,
          status: "scheduled",
          source: input.source ?? "admin",
          conversationId: input.conversationId ?? null,
          notes: input.notes ?? null,
          // Booking público e IA não têm usuário — o autor real fica no histórico
          createdByUserId: ctx.userId || null,
        })
        .returning();

      await tx.insert(appointmentHistory).values({
        organizationId: ctx.organizationId,
        appointmentId: created.id,
        actorType: input.source === "ai" ? "ai" : input.source === "public" ? "public" : "user",
        actorId: ctx.userId || null,
        action: "created",
        after: { startsAt: created.startsAt, professionalId: created.professionalId, status: created.status },
      });

      await tx.insert(domainEvents).values({
        organizationId: ctx.organizationId,
        type: "appointment.created",
        payload: { appointmentId: created.id, customerId: created.customerId, source: created.source },
      });

      return created;
    });
    // A confirmação não pode desfazer um horário já reservado se o WhatsApp
    // estiver momentaneamente indisponível; a falha fica registrada no disparo.
    try {
      await dispatchAppointmentCreatedAutomations(ctx, created.id);
    } catch (error) {
      console.error("[automação] falha na confirmação imediata:", error);
    }
    return created;
  } catch (error) {
    if (isOverlapViolation(error)) throw new DomainError(SLOT_TAKEN, "SLOT_TAKEN");
    throw error;
  }
}

/** Quem executou a ação. Ausente significa o usuário logado do contexto. */
export type Actor = { type: "user" | "ai" | "automation" | "public" | "system"; id?: number | null };

export async function rescheduleAppointment(
  ctx: TenantContext,
  appointmentId: number,
  startsAt: Date,
  professionalId?: number,
  actor?: Actor,
) {
  const [current] = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, appointmentId), eq(appointments.organizationId, ctx.organizationId)))
    .limit(1);
  if (!current) throw new DomainError("Agendamento não encontrado.", "NOT_FOUND");
  if (["completed", "cancelled", "no_show"].includes(current.status))
    throw new DomainError("Esse atendimento já foi encerrado e não pode ser remarcado.", "CLOSED");

  const durationMin = Math.round((current.endsAt.getTime() - current.startsAt.getTime()) / 60000);

  try {
    return await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(appointments)
        .set({
          startsAt,
          endsAt: addMinutes(startsAt, durationMin),
          professionalId: professionalId ?? current.professionalId,
          updatedAt: new Date(),
        })
        .where(and(eq(appointments.id, appointmentId), eq(appointments.organizationId, ctx.organizationId)))
        .returning();

      await tx.insert(appointmentHistory).values({
        organizationId: ctx.organizationId,
        appointmentId,
        actorType: actor?.type ?? "user",
        actorId: actor ? (actor.id ?? null) : ctx.userId,
        action: "rescheduled",
        before: { startsAt: current.startsAt, professionalId: current.professionalId },
        after: { startsAt: updated.startsAt, professionalId: updated.professionalId },
      });

      await tx.insert(domainEvents).values({
        organizationId: ctx.organizationId,
        type: "appointment.rescheduled",
        payload: { appointmentId, from: current.startsAt, to: startsAt },
      });

      return updated;
    });
  } catch (error) {
    if (isOverlapViolation(error)) throw new DomainError(SLOT_TAKEN, "SLOT_TAKEN");
    throw error;
  }
}

export async function changeStatus(
  ctx: TenantContext,
  appointmentId: number,
  next: AppointmentStatus,
  options: { cancelReason?: string; actor?: Actor } = {},
) {
  const [current] = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, appointmentId), eq(appointments.organizationId, ctx.organizationId)))
    .limit(1);
  if (!current) throw new DomainError("Agendamento não encontrado.", "NOT_FOUND");

  const allowed = TRANSITIONS[current.status as AppointmentStatus];
  if (!allowed.includes(next))
    throw new DomainError(
      `Não é possível mudar de ${STATUS_LABEL[current.status as AppointmentStatus]} para ${STATUS_LABEL[next]}.`,
      "INVALID_TRANSITION",
    );

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(appointments)
      .set({ status: next, cancelReason: options.cancelReason ?? null, updatedAt: new Date() })
      .where(and(eq(appointments.id, appointmentId), eq(appointments.organizationId, ctx.organizationId)))
      .returning();

    if (next === "completed") {
      await onCompleted(tx, ctx, updated);
    }
    if (next === "cancelled") {
      await tx
        .update(customers)
        .set({ cancellationsCount: sql`${customers.cancellationsCount} + 1` })
        .where(eq(customers.id, updated.customerId));
    }
    if (next === "no_show") {
      await tx
        .update(customers)
        .set({ noShowCount: sql`${customers.noShowCount} + 1` })
        .where(eq(customers.id, updated.customerId));
    }

    await tx.insert(appointmentHistory).values({
      organizationId: ctx.organizationId,
      appointmentId,
      actorType: options.actor?.type ?? "user",
      actorId: options.actor ? (options.actor.id ?? null) : ctx.userId,
      action: `status:${next}`,
      before: { status: current.status },
      after: { status: next },
    });

    await tx.insert(domainEvents).values({
      organizationId: ctx.organizationId,
      type: `appointment.${next}`,
      payload: { appointmentId, customerId: updated.customerId },
    });

    return updated;
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Conclusão do atendimento: atualiza os agregados do cliente e persiste a
 * comissão do profissional (nunca depender de cálculo retroativo).
 */
async function onCompleted(tx: Tx, ctx: TenantContext, appointment: typeof appointments.$inferSelect) {
  await tx
    .update(customers)
    .set({
      visitsCount: sql`${customers.visitsCount} + 1`,
      totalSpentCents: sql`${customers.totalSpentCents} + ${appointment.priceCents}`,
      lastVisitAt: appointment.startsAt,
      firstVisitAt: sql`coalesce(${customers.firstVisitAt}, ${appointment.startsAt.toISOString()}::timestamptz)`,
    })
    .where(eq(customers.id, appointment.customerId));

  const [override] = await tx
    .select({ bps: professionalServices.commissionBps })
    .from(professionalServices)
    .where(
      and(
        eq(professionalServices.professionalId, appointment.professionalId),
        eq(professionalServices.serviceId, appointment.serviceId),
      ),
    )
    .limit(1);

  const [service] = await tx
    .select({ bps: services.commissionBps })
    .from(services)
    .where(eq(services.id, appointment.serviceId))
    .limit(1);

  const [professional] = await tx
    .select({ bps: professionals.commissionBps })
    .from(professionals)
    .where(eq(professionals.id, appointment.professionalId))
    .limit(1);

  // Precedência: profissional×serviço > serviço > profissional
  const bps = override?.bps ?? service?.bps ?? professional?.bps ?? 0;
  if (bps > 0) {
    await tx
      .insert(commissions)
      .values({
        organizationId: ctx.organizationId,
        appointmentId: appointment.id,
        professionalId: appointment.professionalId,
        baseCents: appointment.priceCents,
        bps,
        amountCents: Math.round((appointment.priceCents * bps) / 10_000),
      })
      .onConflictDoNothing();
  }
}

export type RegisterPaymentInput = {
  appointmentId: number;
  method: "pix" | "cartao_credito" | "cartao_debito" | "dinheiro" | "transferencia" | "outro";
  amountCents: number;
};

/** Um atendimento pode receber vários pagamentos (PIX + cartão, por exemplo). */
export async function registerPayment(ctx: TenantContext, input: RegisterPaymentInput) {
  const [appointment] = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, input.appointmentId), eq(appointments.organizationId, ctx.organizationId)))
    .limit(1);
  if (!appointment) throw new DomainError("Agendamento não encontrado.", "NOT_FOUND");
  if (input.amountCents <= 0) throw new DomainError("Informe um valor maior que zero.", "INVALID_AMOUNT");

  return db.transaction(async (tx) => {
    const [payment] = await tx
      .insert(payments)
      .values({
        organizationId: ctx.organizationId,
        appointmentId: appointment.id,
        customerId: appointment.customerId,
        method: input.method,
        amountCents: input.amountCents,
        createdByUserId: ctx.userId,
      })
      .returning();

    await tx.insert(financialTransactions).values({
      organizationId: ctx.organizationId,
      branchId: appointment.branchId,
      kind: "income",
      status: "paid",
      description: "Atendimento",
      amountCents: input.amountCents,
      dueDate: dateISOInTz(new Date(), ctx.timezone),
      paidAt: new Date(),
      paymentId: payment.id,
      appointmentId: appointment.id,
      customerId: appointment.customerId,
    });

    await tx.insert(domainEvents).values({
      organizationId: ctx.organizationId,
      type: "payment.received",
      payload: { paymentId: payment.id, appointmentId: appointment.id, amountCents: input.amountCents },
    });

    return payment;
  });
}
