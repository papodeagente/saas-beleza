import { generateAccountCode } from "@/lib/account-code";
import { addDays, setHours, setMinutes } from "date-fns";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import * as s from "@/db/schema";
import type { TenantContext } from "@/server/auth";
import { DomainError, createAppointment, registerPayment, changeStatus } from "./appointment-service";
import { getAvailableSlots } from "./availability-service";

/**
 * Testes críticos do brief, contra o Postgres real:
 * 1. Multi-tenancy — tenant A jamais alcança dados do tenant B
 * 2. Double booking — o banco é a autoridade final
 * 3. Financeiro — pagamento e comissão persistidos
 *
 * Cria dois tenants isolados com sufixo próprio e limpa tudo ao final,
 * sem tocar nos dados de demonstração da Clínica Lumina.
 */

const SUFFIX = "vitest-booking";

type Fixture = {
  ctx: TenantContext;
  branchId: number;
  professionalId: number;
  serviceId: number;
  customerId: number;
  equipmentId: number;
  equipmentServiceId: number;
};

async function createTenant(name: string): Promise<Fixture> {
  const [org] = await db
    .insert(s.organizations)
    .values({ publicId: generateAccountCode(), name, slug: `${name}-${SUFFIX}`, timezone: "America/Sao_Paulo" })
    .returning();

  const [user] = await db
    .insert(s.users)
    .values({ name: `Dona ${name}`, email: `${name}-${SUFFIX}@example.test`, passwordHash: "x" })
    .returning();

  await db
    .insert(s.organizationMembers)
    .values({ organizationId: org.id, userId: user.id, role: "owner" });

  const [branch] = await db
    .insert(s.branches)
    .values({ organizationId: org.id, name: "Unidade" })
    .returning();

  const [professional] = await db
    .insert(s.professionals)
    .values({ organizationId: org.id, name: "Profissional", commissionBps: 3000 })
    .returning();

  const [service] = await db
    .insert(s.services)
    .values({
      organizationId: org.id,
      name: "Serviço",
      durationMin: 60,
      priceCents: 20000,
      minLeadMinutes: 0,
      maxLeadDays: 365,
    })
    .returning();

  const [equipment] = await db
    .insert(s.resources)
    .values({ organizationId: org.id, branchId: branch.id, name: "Equipamento", type: "equipment" })
    .returning();

  const [equipmentService] = await db
    .insert(s.services)
    .values({
      organizationId: org.id,
      name: "Serviço com equipamento",
      durationMin: 60,
      priceCents: 50000,
      requiredResourceType: "equipment",
      minLeadMinutes: 0,
      maxLeadDays: 365,
    })
    .returning();

  await db.insert(s.professionalServices).values([
    { organizationId: org.id, professionalId: professional.id, serviceId: service.id },
    { organizationId: org.id, professionalId: professional.id, serviceId: equipmentService.id },
  ]);

  // Grade de segunda a domingo, 08:00–20:00
  await db.insert(s.professionalWorkingHours).values(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      organizationId: org.id,
      professionalId: professional.id,
      branchId: branch.id,
      weekday,
      startTime: "08:00",
      endTime: "20:00",
    })),
  );

  const [customer] = await db
    .insert(s.customers)
    .values({ organizationId: org.id, name: "Cliente", phone: `${org.id}00000000` })
    .returning();

  return {
    ctx: {
      organizationId: org.id,
      organizationName: name,
      organizationSlug: org.slug,
      organizationCode: "TEST-0000",
      timezone: "America/Sao_Paulo",
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      role: "owner",
    },
    branchId: branch.id,
    professionalId: professional.id,
    serviceId: service.id,
    customerId: customer.id,
    equipmentId: equipment.id,
    equipmentServiceId: equipmentService.id,
  };
}

let alpha: Fixture;
let beta: Fixture;

/**
 * Horário futuro, dentro da grade, com segundos zerados.
 * Cada teste recebe um dia próprio (dayOffset) para que atendimentos de 60min
 * não colidam entre si — a colisão que interessa é a provocada de propósito.
 */
function slotAt(dayOffset: number, hour: number, minute = 0): Date {
  const day = setMinutes(setHours(addDays(new Date(), dayOffset), hour), minute);
  day.setSeconds(0, 0);
  return day;
}

beforeAll(async () => {
  await cleanup();
  alpha = await createTenant("alpha");
  beta = await createTenant("beta");
}, 60_000);

afterAll(async () => {
  await cleanup();
  await pool.end();
});

async function cleanup() {
  const orgs = await db
    .select({ id: s.organizations.id })
    .from(s.organizations)
    .where(sql`${s.organizations.slug} like ${`%${SUFFIX}`}`);
  if (orgs.length === 0) return;
  const ids = orgs.map((o) => o.id);
  const inOrgs = sql`organization_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`;
  await db.execute(sql`delete from commissions where ${inOrgs}`);
  await db.execute(sql`delete from financial_transactions where ${inOrgs}`);
  await db.execute(sql`delete from payments where ${inOrgs}`);
  await db.execute(sql`delete from appointment_history where ${inOrgs}`);
  await db.execute(sql`delete from domain_events where ${inOrgs}`);
  await db.execute(sql`delete from appointments where ${inOrgs}`);
  await db.execute(sql`delete from professional_services where ${inOrgs}`);
  await db.execute(sql`delete from professional_working_hours where ${inOrgs}`);
  await db.execute(sql`delete from resources where ${inOrgs}`);
  await db.execute(sql`delete from services where ${inOrgs}`);
  await db.execute(sql`delete from customers where ${inOrgs}`);
  await db.execute(sql`delete from professionals where ${inOrgs}`);
  await db.execute(sql`delete from organization_members where ${inOrgs}`);
  await db.execute(sql`delete from branches where ${inOrgs}`);
  await db.execute(sql`delete from users where email like ${`%${SUFFIX}@example.test`}`);
  await db.execute(sql`delete from organizations where slug like ${`%${SUFFIX}`}`);
}

describe("multi-tenancy", () => {
  it("não cria atendimento com cliente de outro tenant", async () => {
    await expect(
      createAppointment(alpha.ctx, {
        customerId: beta.customerId, // cliente do outro tenant
        serviceId: alpha.serviceId,
        professionalId: alpha.professionalId,
        branchId: alpha.branchId,
        startsAt: slotAt(1, 9),
      }),
    ).rejects.toMatchObject({ code: "CUSTOMER_NOT_FOUND" });
  });

  it("não cria atendimento com serviço de outro tenant", async () => {
    await expect(
      createAppointment(alpha.ctx, {
        customerId: alpha.customerId,
        serviceId: beta.serviceId,
        professionalId: alpha.professionalId,
        branchId: alpha.branchId,
        startsAt: slotAt(1, 9),
      }),
    ).rejects.toMatchObject({ code: "SERVICE_NOT_FOUND" });
  });

  it("não altera status de atendimento de outro tenant", async () => {
    const appointment = await createAppointment(beta.ctx, {
      customerId: beta.customerId,
      serviceId: beta.serviceId,
      professionalId: beta.professionalId,
      branchId: beta.branchId,
      startsAt: slotAt(1, 18),
    });
    // O tenant alpha enxerga o registro do beta como inexistente, nunca como proibido
    await expect(changeStatus(alpha.ctx, appointment.id, "confirmed")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("não registra pagamento em atendimento de outro tenant", async () => {
    const appointment = await createAppointment(beta.ctx, {
      customerId: beta.customerId,
      serviceId: beta.serviceId,
      professionalId: beta.professionalId,
      branchId: beta.branchId,
      startsAt: slotAt(1, 19),
    });
    await expect(
      registerPayment(alpha.ctx, { appointmentId: appointment.id, method: "pix", amountCents: 1000 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("disponibilidade de um tenant ignora a agenda do outro", async () => {
    const dateISO = slotAt(1, 10).toISOString().slice(0, 10);
    const slots = await getAvailableSlots(alpha.ctx, { serviceId: alpha.serviceId, dateISO });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((slot) => slot.professionalId === alpha.professionalId)).toBe(true);
  });
});

describe("double booking", () => {
  it("bloqueia dois atendimentos sobrepostos para o mesmo profissional", async () => {
    const startsAt = slotAt(2, 11);
    await createAppointment(alpha.ctx, {
      customerId: alpha.customerId,
      serviceId: alpha.serviceId,
      professionalId: alpha.professionalId,
      branchId: alpha.branchId,
      startsAt,
    });

    await expect(
      createAppointment(alpha.ctx, {
        customerId: alpha.customerId,
        serviceId: alpha.serviceId,
        professionalId: alpha.professionalId,
        branchId: alpha.branchId,
        startsAt: new Date(startsAt.getTime() + 30 * 60_000), // sobrepõe 30min
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("resiste a duas confirmações simultâneas do mesmo horário", async () => {
    const startsAt = slotAt(3, 13);
    const attempt = () =>
      createAppointment(alpha.ctx, {
        customerId: alpha.customerId,
        serviceId: alpha.serviceId,
        professionalId: alpha.professionalId,
        branchId: alpha.branchId,
        startsAt,
      });

    const results = await Promise.allSettled([attempt(), attempt()]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    // A garantia é do banco (EXCLUDE constraint), não da checagem prévia
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(DomainError);
  });

  it("bloqueia dois atendimentos no mesmo equipamento", async () => {
    const startsAt = slotAt(4, 15);
    await createAppointment(alpha.ctx, {
      customerId: alpha.customerId,
      serviceId: alpha.equipmentServiceId,
      professionalId: alpha.professionalId,
      branchId: alpha.branchId,
      startsAt,
      resourceId: alpha.equipmentId,
    });

    const [other] = await db
      .insert(s.professionals)
      .values({ organizationId: alpha.ctx.organizationId, name: "Outro profissional" })
      .returning();

    await expect(
      createAppointment(alpha.ctx, {
        customerId: alpha.customerId,
        serviceId: alpha.equipmentServiceId,
        professionalId: other.id, // profissional livre…
        branchId: alpha.branchId,
        startsAt, // …mas o equipamento não está
        resourceId: alpha.equipmentId,
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("permite reaproveitar o horário depois do cancelamento", async () => {
    const startsAt = slotAt(5, 16);
    const first = await createAppointment(alpha.ctx, {
      customerId: alpha.customerId,
      serviceId: alpha.serviceId,
      professionalId: alpha.professionalId,
      branchId: alpha.branchId,
      startsAt,
    });
    await changeStatus(alpha.ctx, first.id, "cancelled");

    const second = await createAppointment(alpha.ctx, {
      customerId: alpha.customerId,
      serviceId: alpha.serviceId,
      professionalId: alpha.professionalId,
      branchId: alpha.branchId,
      startsAt,
    });
    expect(second.id).not.toBe(first.id);
  });

  it("remove da disponibilidade um horário recém-ocupado", async () => {
    const startsAt = slotAt(6, 8, 30);
    const dateISO = startsAt.toISOString().slice(0, 10);
    const before = await getAvailableSlots(alpha.ctx, { serviceId: alpha.serviceId, dateISO });
    expect(before.some((slot) => slot.start.getTime() === startsAt.getTime())).toBe(true);

    await createAppointment(alpha.ctx, {
      customerId: alpha.customerId,
      serviceId: alpha.serviceId,
      professionalId: alpha.professionalId,
      branchId: alpha.branchId,
      startsAt,
    });

    const after = await getAvailableSlots(alpha.ctx, { serviceId: alpha.serviceId, dateISO });
    expect(after.some((slot) => slot.start.getTime() === startsAt.getTime())).toBe(false);
  });
});

describe("financeiro", () => {
  it("soma pagamentos parciais e gera lançamento para cada um", async () => {
    const appointment = await createAppointment(alpha.ctx, {
      customerId: alpha.customerId,
      serviceId: alpha.serviceId, // R$ 200,00
      professionalId: alpha.professionalId,
      branchId: alpha.branchId,
      startsAt: slotAt(7, 17),
    });

    await registerPayment(alpha.ctx, { appointmentId: appointment.id, method: "pix", amountCents: 5000 });
    await registerPayment(alpha.ctx, {
      appointmentId: appointment.id,
      method: "cartao_credito",
      amountCents: 15000,
    });

    const rows = await db
      .select({ amount: s.payments.amountCents })
      .from(s.payments)
      .where(eq(s.payments.appointmentId, appointment.id));
    expect(rows.reduce((sum, r) => sum + r.amount, 0)).toBe(20000);

    const transactions = await db
      .select()
      .from(s.financialTransactions)
      .where(eq(s.financialTransactions.appointmentId, appointment.id));
    expect(transactions).toHaveLength(2);
    expect(transactions.every((t) => t.kind === "income" && t.status === "paid")).toBe(true);
  });

  it("recusa pagamento com valor zerado", async () => {
    const appointment = await createAppointment(alpha.ctx, {
      customerId: alpha.customerId,
      serviceId: alpha.serviceId,
      professionalId: alpha.professionalId,
      branchId: alpha.branchId,
      startsAt: slotAt(8, 9, 30),
    });
    await expect(
      registerPayment(alpha.ctx, { appointmentId: appointment.id, method: "pix", amountCents: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
  });

  it("persiste a comissão e os agregados do cliente ao concluir", async () => {
    const appointment = await createAppointment(alpha.ctx, {
      customerId: alpha.customerId,
      serviceId: alpha.serviceId,
      professionalId: alpha.professionalId,
      branchId: alpha.branchId,
      startsAt: slotAt(9, 12),
    });

    const [before] = await db
      .select({ visits: s.customers.visitsCount, spent: s.customers.totalSpentCents })
      .from(s.customers)
      .where(eq(s.customers.id, alpha.customerId));

    await changeStatus(alpha.ctx, appointment.id, "completed");

    const [commission] = await db
      .select()
      .from(s.commissions)
      .where(eq(s.commissions.appointmentId, appointment.id));
    // 30% de R$ 200,00 (comissão do profissional, sem override)
    expect(commission.bps).toBe(3000);
    expect(commission.amountCents).toBe(6000);

    const [after] = await db
      .select({ visits: s.customers.visitsCount, spent: s.customers.totalSpentCents })
      .from(s.customers)
      .where(eq(s.customers.id, alpha.customerId));
    expect(after.visits).toBe(before.visits + 1);
    expect(after.spent).toBe(before.spent + 20000);
  });

  it("recusa transição inválida de status", async () => {
    const appointment = await createAppointment(alpha.ctx, {
      customerId: alpha.customerId,
      serviceId: alpha.serviceId,
      professionalId: alpha.professionalId,
      branchId: alpha.branchId,
      startsAt: slotAt(10, 14),
    });
    await changeStatus(alpha.ctx, appointment.id, "cancelled");
    await expect(changeStatus(alpha.ctx, appointment.id, "completed")).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });

  it("registra o evento de domínio de cada mudança relevante", async () => {
    const appointment = await createAppointment(alpha.ctx, {
      customerId: alpha.customerId,
      serviceId: alpha.serviceId,
      professionalId: alpha.professionalId,
      branchId: alpha.branchId,
      startsAt: slotAt(11, 10, 30),
    });

    const events = await db
      .select({ type: s.domainEvents.type })
      .from(s.domainEvents)
      .where(
        and(
          eq(s.domainEvents.organizationId, alpha.ctx.organizationId),
          sql`payload->>'appointmentId' = ${String(appointment.id)}`,
        ),
      );
    expect(events.map((e) => e.type)).toContain("appointment.created");
  });
});

/**
 * As duas guardas que o marketplace tornou urgentes.
 *
 * Antes, `createAppointment` conferia só serviço e cliente. Profissional,
 * unidade e recurso iam do chamador direto para o INSERT, e as chaves
 * estrangeiras de `appointments` são simples — não compostas com
 * `organization_id` — então o banco aceitava um agendamento da conta A
 * apontando para a profissional da conta B. E `startsAt` não passava por
 * validação nenhuma: um POST forjado marcava às 3h da manhã.
 *
 * Enquanto cada link público expunha só os próprios ids, isso era obscuro. Num
 * diretório de manicures, ids de vários salões aparecem na mesma tela.
 */
describe("guardas do caminho público", () => {
  it("recusa profissional de outro tenant", async () => {
    await expect(
      createAppointment(alpha.ctx, {
        customerId: alpha.customerId,
        serviceId: alpha.serviceId,
        professionalId: beta.professionalId,
        branchId: alpha.branchId,
        startsAt: slotAt(20, 9),
      }),
    ).rejects.toMatchObject({ code: "PROFESSIONAL_NOT_FOUND" });
  });

  it("recusa unidade de outro tenant", async () => {
    await expect(
      createAppointment(alpha.ctx, {
        customerId: alpha.customerId,
        serviceId: alpha.serviceId,
        professionalId: alpha.professionalId,
        branchId: beta.branchId,
        startsAt: slotAt(20, 10),
      }),
    ).rejects.toMatchObject({ code: "BRANCH_NOT_FOUND" });
  });

  it("recusa recurso de outro tenant", async () => {
    await expect(
      createAppointment(alpha.ctx, {
        customerId: alpha.customerId,
        serviceId: alpha.equipmentServiceId,
        professionalId: alpha.professionalId,
        branchId: alpha.branchId,
        resourceId: beta.equipmentId,
        startsAt: slotAt(20, 11),
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });

  it("recusa horário fora da grade quando a origem é pública", async () => {
    // A grade da fixture é 08:00–20:00. 03:00 nunca foi aberto pela clínica, e
    // o EXCLUDE não pega isso: ele só enxerga colisão com o que já existe.
    await expect(
      createAppointment(alpha.ctx, {
        customerId: alpha.customerId,
        serviceId: alpha.serviceId,
        professionalId: alpha.professionalId,
        branchId: alpha.branchId,
        startsAt: slotAt(21, 3),
        source: "public",
      }),
    ).rejects.toMatchObject({ code: "SLOT_NOT_AVAILABLE" });
  });

  it("recusa horário fora da grade quando quem marca é o agente de IA", async () => {
    await expect(
      createAppointment(alpha.ctx, {
        customerId: alpha.customerId,
        serviceId: alpha.serviceId,
        professionalId: alpha.professionalId,
        branchId: alpha.branchId,
        startsAt: slotAt(21, 23),
        source: "ai",
      }),
    ).rejects.toMatchObject({ code: "SLOT_NOT_AVAILABLE" });
  });

  it("deixa a recepção fazer encaixe fora da grade", async () => {
    // Encaixe é operação legítima de quem está autenticado no tenant. A guarda
    // existe contra o caminho anônimo, não contra a dona do salão.
    const appointment = await createAppointment(alpha.ctx, {
      customerId: alpha.customerId,
      serviceId: alpha.serviceId,
      professionalId: alpha.professionalId,
      branchId: alpha.branchId,
      startsAt: slotAt(22, 6, 30),
      source: "admin",
    });
    expect(appointment.id).toBeGreaterThan(0);
  });

  it("aceita horário que está de fato na grade pelo caminho público", async () => {
    const appointment = await createAppointment(alpha.ctx, {
      customerId: alpha.customerId,
      serviceId: alpha.serviceId,
      professionalId: alpha.professionalId,
      branchId: alpha.branchId,
      startsAt: slotAt(23, 9),
      source: "public",
    });
    expect(appointment.id).toBeGreaterThan(0);
  });
});
