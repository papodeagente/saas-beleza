import "server-only";
import { addDays } from "date-fns";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  appointments,
  automationDispatches,
  automationRules,
  customers,
  organizationMembers,
  organizations,
  payments,
  professionals,
  services,
  users,
} from "@/db/schema";
import { dateISOInTz, formatTz, localDateTimeToUtc } from "@/lib/tz";
import type { TenantContext } from "@/server/auth";
import { startOutboundConversation } from "@/server/services/outbound-conversation-service";

export type AutomationTrigger =
  | "appointment_created"
  | "before_appointment"
  | "appointment_day"
  | "after_appointment"
  | "after_purchase";

type Candidate = {
  sourceType: "appointment" | "payment";
  sourceId: number;
  customerId: number;
  customerName: string;
  consentMarketing: boolean;
  eventAt: Date;
  serviceName?: string | null;
  professionalName?: string | null;
};

export type AutomationRuleInput = {
  name: string;
  trigger: AutomationTrigger;
  daysOffset: number;
  sendTime: string;
  messageTemplate: string;
  active: boolean;
};

export async function listAutomationRules(ctx: TenantContext) {
  return db
    .select()
    .from(automationRules)
    .where(eq(automationRules.organizationId, ctx.organizationId))
    .orderBy(asc(automationRules.createdAt));
}

export async function createAutomationRule(ctx: TenantContext, input: AutomationRuleInput) {
  await db.insert(automationRules).values({
    organizationId: ctx.organizationId,
    ...input,
    daysOffset: input.trigger === "appointment_day" || input.trigger === "appointment_created" ? 0 : input.daysOffset,
    createdByUserId: ctx.userId,
  });
}

export async function setAutomationRuleActive(ctx: TenantContext, id: number, active: boolean) {
  const changed = await db
    .update(automationRules)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(automationRules.id, id), eq(automationRules.organizationId, ctx.organizationId)))
    .returning({ id: automationRules.id });
  if (!changed.length) throw new Error("Automação não encontrada.");
}

export async function deleteAutomationRule(ctx: TenantContext, id: number) {
  // Mantém o histórico de disparos: uma regra usada é apenas desativada.
  const used = await db
    .select({ id: automationDispatches.id })
    .from(automationDispatches)
    .where(and(eq(automationDispatches.organizationId, ctx.organizationId), eq(automationDispatches.ruleId, id)))
    .limit(1);
  if (used.length) return setAutomationRuleActive(ctx, id, false);
  await db
    .delete(automationRules)
    .where(and(eq(automationRules.id, id), eq(automationRules.organizationId, ctx.organizationId)));
}

export function automationScheduledFor(eventAt: Date, trigger: AutomationTrigger, days: number, time: string, timezone: string) {
  if (trigger === "appointment_created") return eventAt;
  const signedDays = trigger === "before_appointment" ? -days : trigger === "appointment_day" ? 0 : days;
  const targetDay = addDays(eventAt, signedDays);
  return localDateTimeToUtc(dateISOInTz(targetDay, timezone), time.slice(0, 5), timezone);
}

export function renderAutomationTemplate(
  template: string,
  candidate: Candidate,
  timezone: string,
  bookingUrl: string,
) {
  const firstName = candidate.customerName.trim().split(/\s+/)[0] ?? candidate.customerName;
  const values: Record<string, string> = {
    nome: firstName,
    cliente: candidate.customerName,
    servico: candidate.serviceName ?? "seu atendimento",
    profissional: candidate.professionalName ?? "nossa equipe",
    data: formatTz(candidate.eventAt, timezone, "dd/MM/yyyy"),
    hora: formatTz(candidate.eventAt, timezone, "HH:mm"),
    link_agendamento: bookingUrl,
  };
  return template.replace(/\{(nome|cliente|servico|profissional|data|hora|link_agendamento)\}/g, (_, key) => values[key]);
}

async function candidatesForRule(rule: typeof automationRules.$inferSelect, now: Date): Promise<Candidate[]> {
  // Janela larga o bastante para recuperar envios depois de uma indisponibilidade,
  // sem varrer o histórico inteiro a cada 30 segundos.
  const since = addDays(now, -120);
  const until = addDays(now, 120);
  if (rule.trigger === "after_purchase") {
    const rows = await db
      .select({
        sourceId: payments.id,
        customerId: customers.id,
        customerName: customers.name,
        consentMarketing: customers.consentMarketing,
        eventAt: payments.paidAt,
      })
      .from(payments)
      .innerJoin(customers, eq(customers.id, payments.customerId))
      .where(
        and(
          eq(payments.organizationId, rule.organizationId),
          gte(payments.paidAt, since),
          lte(payments.paidAt, now),
        ),
      )
      .orderBy(desc(payments.paidAt))
      .limit(500);
    // Só a compra confirmada mais recente de cada cliente pode reativá-la.
    const seen = new Set<number>();
    return rows
      .filter((row) => row.customerId && !seen.has(row.customerId) && seen.add(row.customerId))
      .map((row) => ({ ...row, customerId: row.customerId!, sourceType: "payment" as const }));
  }

  const statuses = rule.trigger === "after_appointment" ? ["completed" as const] : ["scheduled" as const, "confirmed" as const];
  const rows = await db
    .select({
      sourceId: appointments.id,
      customerId: customers.id,
      customerName: customers.name,
      consentMarketing: customers.consentMarketing,
      eventAt: appointments.startsAt,
      serviceName: services.name,
      professionalName: professionals.name,
    })
    .from(appointments)
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(professionals, eq(professionals.id, appointments.professionalId))
    .where(
      and(
        eq(appointments.organizationId, rule.organizationId),
        inArray(appointments.status, statuses),
        gte(appointments.startsAt, since),
        lte(appointments.startsAt, until),
      ),
    )
    .limit(500);
  const mapped = rows.map((row) => ({ ...row, sourceType: "appointment" as const }));
  if (rule.trigger !== "after_appointment") return mapped;
  // "Depois do último atendimento": se houve outro mais recente, o antigo
  // deixa de ser elegível e não gera uma reativação fora de contexto.
  mapped.sort((a, b) => b.eventAt.getTime() - a.eventAt.getTime());
  const seen = new Set<number>();
  return mapped.filter((row) => {
    if (seen.has(row.customerId)) return false;
    seen.add(row.customerId);
    return true;
  });
}

/**
 * Dispara a confirmação operacional logo após o commit do agendamento.
 * O livro-razão torna a operação idempotente, inclusive se uma rota repetir a chamada.
 */
export async function dispatchAppointmentCreatedAutomations(ctx: TenantContext, appointmentId: number) {
  const rules = await db
    .select()
    .from(automationRules)
    .where(
      and(
        eq(automationRules.organizationId, ctx.organizationId),
        eq(automationRules.trigger, "appointment_created"),
        eq(automationRules.active, true),
      ),
    );
  if (!rules.length) return;

  const [row] = await db
    .select({
      sourceId: appointments.id,
      customerId: customers.id,
      customerName: customers.name,
      consentMarketing: customers.consentMarketing,
      eventAt: appointments.startsAt,
      serviceName: services.name,
      professionalName: professionals.name,
    })
    .from(appointments)
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(professionals, eq(professionals.id, appointments.professionalId))
    .where(and(eq(appointments.id, appointmentId), eq(appointments.organizationId, ctx.organizationId)))
    .limit(1);
  if (!row) return;

  const candidate: Candidate = { ...row, sourceType: "appointment" };
  const bookingUrl = `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/agendar/${ctx.organizationSlug}`;
  for (const rule of rules) {
    const message = renderAutomationTemplate(rule.messageTemplate, candidate, ctx.timezone, bookingUrl);
    const now = new Date();
    const [claimed] = await db
      .insert(automationDispatches)
      .values({
        organizationId: ctx.organizationId,
        ruleId: rule.id,
        customerId: candidate.customerId,
        sourceType: candidate.sourceType,
        sourceId: candidate.sourceId,
        scheduledFor: now,
        message,
      })
      .onConflictDoNothing()
      .returning({ id: automationDispatches.id });
    if (!claimed) continue;

    const result = await startOutboundConversation(ctx, { customerId: candidate.customerId, body: message, automated: true });
    await db
      .update(automationDispatches)
      .set(result.ok
        ? { status: "sent", sentAt: new Date() }
        : { status: "failed", error: result.error.slice(0, 500) })
      .where(eq(automationDispatches.id, claimed.id));
  }
}

async function automationContext(organizationId: number): Promise<TenantContext | null> {
  const [row] = await db
    .select({
      organizationId: organizations.id,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
      timezone: organizations.timezone,
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
      role: organizationMembers.role,
    })
    .from(organizations)
    .innerJoin(organizationMembers, eq(organizationMembers.organizationId, organizations.id))
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizations.id, organizationId), inArray(organizationMembers.role, ["owner", "admin"])))
    .orderBy(asc(organizationMembers.id))
    .limit(1);
  return row ?? null;
}

/** Envia regras vencidas; seguro para múltiplas réplicas e reinicializações. */
export async function dispatchDueAutomations(now = new Date()) {
  const rules = await db.select().from(automationRules).where(eq(automationRules.active, true));
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const rule of rules) {
    if (rule.trigger === "appointment_created") continue;
    const ctx = await automationContext(rule.organizationId);
    if (!ctx) continue;
    const candidates = await candidatesForRule(rule, now);
    const bookingUrl = `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/agendar/${ctx.organizationSlug}`;

    for (const candidate of candidates) {
      const due = automationScheduledFor(candidate.eventAt, rule.trigger, rule.daysOffset, rule.sendTime, ctx.timezone);
      if (due > now || due < addDays(now, -1)) continue;
      if ((rule.trigger === "before_appointment" || rule.trigger === "appointment_day") && candidate.eventAt <= now) continue;
      const message = renderAutomationTemplate(rule.messageTemplate, candidate, ctx.timezone, bookingUrl);
      const [claimed] = await db
        .insert(automationDispatches)
        .values({
          organizationId: rule.organizationId,
          ruleId: rule.id,
          customerId: candidate.customerId,
          sourceType: candidate.sourceType,
          sourceId: candidate.sourceId,
          scheduledFor: due,
          message,
        })
        .onConflictDoNothing()
        .returning({ id: automationDispatches.id });
      if (!claimed) continue;

      // Reativação é marketing; lembrete operacional de agenda não é.
      if ((rule.trigger === "after_appointment" || rule.trigger === "after_purchase") && !candidate.consentMarketing) {
        await db.update(automationDispatches).set({ status: "skipped", error: "Cliente sem consentimento de marketing." }).where(eq(automationDispatches.id, claimed.id));
        skipped += 1;
        continue;
      }
      const result = await startOutboundConversation(ctx, { customerId: candidate.customerId, body: message, automated: true });
      if (result.ok) {
        await db.update(automationDispatches).set({ status: "sent", sentAt: new Date() }).where(eq(automationDispatches.id, claimed.id));
        sent += 1;
      } else {
        await db.update(automationDispatches).set({ status: "failed", error: result.error.slice(0, 500) }).where(eq(automationDispatches.id, claimed.id));
        failed += 1;
      }
    }
  }
  return { sent, failed, skipped };
}
