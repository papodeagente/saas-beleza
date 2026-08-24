import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { generateAccountCode } from "@/lib/account-code";
import { addDays, addMinutes, setHours, setMinutes, subDays } from "date-fns";
import { sql } from "drizzle-orm";
import { db, pool } from "./index";
import * as s from "./schema";

// Rodar sempre via `pnpm db:seed` — o script carrega .env.local antes do processo
// subir. Os imports ESM são içados, então dotenv dentro deste arquivo chegaria tarde.

/**
 * Clínica Lumina — organização de demonstração.
 * Dados realistas o suficiente para que toda tela pareça uma clínica em operação.
 */

const TZ = "America/Sao_Paulo";
/**
 * Senha da demonstração, sorteada a cada execução.
 *
 * Era um hash fixo no código, com a senha em claro no comentário e repetida no
 * README de um repositório público. Como este seed roda contra um banco que
 * hospeda contas reais, aquela linha era uma credencial válida publicada — e a
 * conta de demonstração é dona de uma organização com dados e WhatsApp ligado.
 *
 * Agora a senha existe apenas no banco em que o seed rodou, e é impressa no
 * console de quem o executou.
 */
const DEMO_PASSWORD = `${randomBytes(6).toString("base64url")}-${randomBytes(4).toString("base64url")}`;
const PASSWORD_HASH = bcrypt.hashSync(DEMO_PASSWORD, 12);

async function reset() {
  await db.execute(sql`
    truncate table
      ai_execution_logs, ai_agents, messages, conversations,
      audit_logs, domain_events, commissions, financial_transactions,
      financial_categories, payments, appointment_history, appointments,
      customer_tag_links, customer_tags, customers, schedule_blocks,
      professional_working_hours, professional_services, resources,
      services, service_categories, professionals, organization_members,
      sessions, users, branches, organizations
    restart identity cascade
  `);
}

/**
 * Trava contra apagar o que é real.
 *
 * O seed existe para demonstração e começa truncando o banco inteiro. Isso era
 * inofensivo enquanto o banco só tinha a clínica de exemplo — mas o mesmo
 * Postgres passou a hospedar contas de verdade e o acesso de plataforma. Um
 * `pnpm db:seed` distraído apagaria tudo, sem pergunta e sem volta.
 *
 * A checagem é boba de propósito: qualquer coisa fora do cenário de
 * demonstração (outra clínica, um administrador de plataforma) exige que a
 * pessoa diga em voz alta, pela variável de ambiente, que é isso mesmo que
 * quer.
 */
async function confirmarQuePodeApagar() {
  if (process.env.SEED_APAGAR_TUDO === "sim") return;

  const orgs = await db.select({ id: s.organizations.id, slug: s.organizations.slug }).from(s.organizations);
  const forasteiras = orgs.filter((o) => o.slug !== "clinica-lumina" && !o.slug.startsWith("demo-"));
  const [admin] = await db.select({ id: s.platformAdmins.id }).from(s.platformAdmins).limit(1);

  if (forasteiras.length === 0 && !admin) return;

  const motivos: string[] = [];
  if (forasteiras.length > 0) {
    motivos.push(
      `${forasteiras.length} clínica(s) que não são de demonstração: ${forasteiras.map((o) => o.slug).join(", ")}`,
    );
  }
  if (admin) motivos.push("acesso de administrador da plataforma");

  console.error(
    [
      "",
      "  O seed apaga TODAS as tabelas do banco antes de recriar a demonstração.",
      `  Este banco tem ${motivos.join(" e ")}.`,
      "",
      `  Banco alvo: ${(process.env.DATABASE_URL ?? "").replace(/:[^@]*@/, ":****@")}`,
      "",
      "  Se é isso mesmo que você quer, rode de novo com:",
      "    SEED_APAGAR_TUDO=sim pnpm db:seed",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

async function main() {
  await confirmarQuePodeApagar();
  await reset();

  const [org] = await db
    .insert(s.organizations)
    .values({ publicId: generateAccountCode(), name: "Clínica Lumina", slug: "clinica-lumina", timezone: TZ })
    .returning();
  const orgId = org.id;

  const [tirol, pontaNegra] = await db
    .insert(s.branches)
    .values([
      { organizationId: orgId, name: "Tirol", address: "Av. Afonso Pena, 744 — Tirol, Natal/RN", phone: "84 3211-4400" },
      { organizationId: orgId, name: "Ponta Negra", address: "Av. Eng. Roberto Freire, 1962 — Natal/RN", phone: "84 3219-8800" },
    ])
    .returning();

  const [owner, recepcao] = await db
    .insert(s.users)
    .values([
      { name: "Mariana Albuquerque", email: "mariana@clinicalumina.com.br", passwordHash: PASSWORD_HASH },
      { name: "Beatriz Nogueira", email: "beatriz@clinicalumina.com.br", passwordHash: PASSWORD_HASH },
    ])
    .returning();

  await db.insert(s.organizationMembers).values([
    { organizationId: orgId, userId: owner.id, role: "owner" },
    { organizationId: orgId, userId: recepcao.id, role: "staff" },
  ]);

  const [ana, carolina, marianaProf, juliana] = await db
    .insert(s.professionals)
    .values([
      { organizationId: orgId, name: "Ana Ferreira", specialty: "Esteticista facial", color: "#7C2D3E", commissionBps: 3000 },
      { organizationId: orgId, name: "Carolina Sales", specialty: "Biomédica esteta", color: "#3E5F8A", commissionBps: 3500 },
      { organizationId: orgId, userId: owner.id, name: "Mariana Albuquerque", specialty: "Dermatologista", color: "#3D7A50", commissionBps: 4000 },
      { organizationId: orgId, name: "Juliana Rocha", specialty: "Massoterapeuta", color: "#996A1F", commissionBps: 2500 },
    ])
    .returning();

  const [facial, corporal, injetaveis] = await db
    .insert(s.serviceCategories)
    .values([
      { organizationId: orgId, name: "Facial", position: 1 },
      { organizationId: orgId, name: "Corporal", position: 2 },
      { organizationId: orgId, name: "Injetáveis", position: 3 },
    ])
    .returning();

  const [botox, limpeza, drenagem, hifu, laser, massagem] = await db
    .insert(s.services)
    .values([
      {
        organizationId: orgId, categoryId: injetaveis.id, name: "Botox Facial",
        description: "Toxina botulínica para terço superior. Retoque incluso em 15 dias.",
        durationMin: 60, bufferBeforeMin: 10, bufferAfterMin: 10,
        priceCents: 120000, costCents: 38000, commissionBps: 2000,
        minLeadMinutes: 240, maxLeadDays: 90, returnIntervalDays: 180,
      },
      {
        organizationId: orgId, categoryId: facial.id, name: "Limpeza de Pele Profunda",
        description: "Higienização, extração, alta frequência e máscara calmante.",
        durationMin: 90, bufferBeforeMin: 10, bufferAfterMin: 15,
        priceCents: 28000, costCents: 6500,
        minLeadMinutes: 120, maxLeadDays: 60, returnIntervalDays: 45,
      },
      {
        organizationId: orgId, categoryId: corporal.id, name: "Drenagem Linfática",
        description: "Sessão corporal de 60 minutos.",
        durationMin: 60, bufferBeforeMin: 5, bufferAfterMin: 10,
        priceCents: 18000, costCents: 3000,
        minLeadMinutes: 60, maxLeadDays: 45, returnIntervalDays: 15,
      },
      {
        organizationId: orgId, categoryId: facial.id, name: "HIFU Facial",
        description: "Ultrassom microfocado para lifting não cirúrgico.",
        durationMin: 90, bufferBeforeMin: 15, bufferAfterMin: 15,
        priceCents: 250000, costCents: 72000, commissionBps: 1500,
        requiredResourceType: "equipment",
        minLeadMinutes: 1440, maxLeadDays: 120, returnIntervalDays: 365,
      },
      {
        organizationId: orgId, categoryId: corporal.id, name: "Depilação a Laser",
        description: "Sessão de axilas e virilha. Protocolo de 8 sessões.",
        durationMin: 45, bufferBeforeMin: 5, bufferAfterMin: 10,
        priceCents: 32000, costCents: 8000,
        requiredResourceType: "equipment",
        minLeadMinutes: 120, maxLeadDays: 90, returnIntervalDays: 30,
      },
      {
        organizationId: orgId, categoryId: corporal.id, name: "Massagem Relaxante",
        description: "Sessão de 60 minutos com óleos essenciais.",
        durationMin: 60, bufferBeforeMin: 5, bufferAfterMin: 10,
        priceCents: 16000, costCents: 2500,
        minLeadMinutes: 60, maxLeadDays: 45, returnIntervalDays: 30,
      },
    ])
    .returning();

  const [, , hifuEquip, laserEquip] = await db
    .insert(s.resources)
    .values([
      { organizationId: orgId, branchId: tirol.id, name: "Sala 1", type: "room" },
      { organizationId: orgId, branchId: tirol.id, name: "Sala 2", type: "room" },
      { organizationId: orgId, branchId: tirol.id, name: "Ultraformer HIFU", type: "equipment" },
      { organizationId: orgId, branchId: tirol.id, name: "Laser Soprano", type: "equipment" },
      { organizationId: orgId, branchId: pontaNegra.id, name: "Cabine Ponta Negra", type: "cabin" },
    ])
    .returning();

  // Quem faz o quê
  const links: Array<{ p: number; svc: number }> = [
    { p: ana.id, svc: limpeza.id }, { p: ana.id, svc: hifu.id }, { p: ana.id, svc: laser.id },
    { p: carolina.id, svc: botox.id }, { p: carolina.id, svc: hifu.id }, { p: carolina.id, svc: limpeza.id },
    { p: marianaProf.id, svc: botox.id }, { p: marianaProf.id, svc: hifu.id },
    { p: juliana.id, svc: drenagem.id }, { p: juliana.id, svc: massagem.id },
  ];
  await db.insert(s.professionalServices).values(
    links.map((l) => ({ organizationId: orgId, professionalId: l.p, serviceId: l.svc })),
  );

  // Grade semanal (segunda a sexta; sábado para Ana e Juliana)
  const hours: Array<typeof s.professionalWorkingHours.$inferInsert> = [];
  for (const weekday of [1, 2, 3, 4, 5]) {
    for (const p of [ana, carolina, marianaProf, juliana]) {
      hours.push({
        organizationId: orgId, professionalId: p.id, branchId: tirol.id,
        weekday, startTime: "09:00", endTime: "18:00",
      });
    }
  }
  for (const p of [ana, juliana]) {
    hours.push({
      organizationId: orgId, professionalId: p.id, branchId: pontaNegra.id,
      weekday: 6, startTime: "09:00", endTime: "14:00",
    });
  }
  await db.insert(s.professionalWorkingHours).values(hours);

  const [vip, novo, retorno] = await db
    .insert(s.customerTags)
    .values([
      { organizationId: orgId, name: "VIP" },
      { organizationId: orgId, name: "Primeira vez" },
      { organizationId: orgId, name: "Indicação" },
    ])
    .returning();

  const customerSeed = [
    { name: "Renata Cavalcanti", phone: "84991234501", email: "renata.cavalcanti@gmail.com", source: "whatsapp" as const },
    { name: "Patrícia Menezes", phone: "84991234502", email: "patricia.menezes@outlook.com", source: "manual" as const },
    { name: "Luciana Wanderley", phone: "84991234503", email: null, source: "public_booking" as const },
    { name: "Fernanda Duarte", phone: "84991234504", email: "fe.duarte@gmail.com", source: "whatsapp" as const },
    { name: "Camila Bezerra", phone: "84991234505", email: null, source: "manual" as const },
    { name: "Tatiana Lima", phone: "84991234506", email: "tatiana.lima@gmail.com", source: "ai" as const },
    { name: "Juliana Praxedes", phone: "84991234507", email: null, source: "whatsapp" as const },
    { name: "Adriana Fontes", phone: "84991234508", email: "adriana.fontes@gmail.com", source: "manual" as const },
    { name: "Marcela Guedes", phone: "84991234509", email: null, source: "public_booking" as const },
    { name: "Beatriz Sampaio", phone: "84991234510", email: "bia.sampaio@gmail.com", source: "whatsapp" as const },
    { name: "Vanessa Torres", phone: "84991234511", email: null, source: "manual" as const },
    { name: "Rafaela Pinheiro", phone: "84991234512", email: "rafaela.pinheiro@gmail.com", source: "ai" as const },
    { name: "Larissa Andrade", phone: "84991234513", email: null, source: "whatsapp" as const },
    { name: "Isabela Monteiro", phone: "84991234514", email: "isabela.monteiro@gmail.com", source: "manual" as const },
    { name: "Gabriela Peixoto", phone: "84991234515", email: null, source: "public_booking" as const },
    { name: "Sofia Bandeira", phone: "84991234516", email: "sofia.bandeira@gmail.com", source: "whatsapp" as const },
    { name: "Helena Coutinho", phone: "84991234517", email: null, source: "manual" as const },
    { name: "Clara Vasconcelos", phone: "84991234518", email: "clara.vasc@gmail.com", source: "ai" as const },
  ];

  const insertedCustomers = await db
    .insert(s.customers)
    .values(
      customerSeed.map((c, i) => ({
        organizationId: orgId,
        name: c.name,
        phone: c.phone,
        email: c.email,
        source: c.source,
        preferredBranchId: i % 4 === 0 ? pontaNegra.id : tirol.id,
        consentMarketing: i % 3 !== 0,
      })),
    )
    .returning();

  await db.insert(s.customerTagLinks).values([
    { organizationId: orgId, customerId: insertedCustomers[0].id, tagId: vip.id },
    { organizationId: orgId, customerId: insertedCustomers[3].id, tagId: vip.id },
    { organizationId: orgId, customerId: insertedCustomers[11].id, tagId: vip.id },
    { organizationId: orgId, customerId: insertedCustomers[8].id, tagId: novo.id },
    { organizationId: orgId, customerId: insertedCustomers[14].id, tagId: novo.id },
    { organizationId: orgId, customerId: insertedCustomers[5].id, tagId: retorno.id },
  ]);

  // -------------------------------------------------------------------------
  // Histórico + agenda de hoje + próximos dias
  // -------------------------------------------------------------------------
  const now = new Date();
  const serviceById = new Map([botox, limpeza, drenagem, hifu, laser, massagem].map((x) => [x.id, x]));
  const proById = new Map([ana, carolina, marianaProf, juliana].map((x) => [x.id, x]));

  function slot(dayOffset: number, hour: number, minute = 0): Date {
    return setMinutes(setHours(addDays(now, dayOffset), hour), minute);
  }

  type Plan = {
    dayOffset: number; hour: number; minute?: number;
    customerIdx: number; serviceId: number; professionalId: number;
    status: (typeof s.appointmentStatus.enumValues)[number];
    branchId?: number; resourceId?: number | null;
    source?: "admin" | "public" | "whatsapp" | "ai";
    paid?: boolean;
  };

  const plans: Plan[] = [
    // --- Passado (constrói histórico, LTV e sinais de retorno) ---
    { dayOffset: -112, hour: 10, customerIdx: 0, serviceId: limpeza.id, professionalId: ana.id, status: "completed", paid: true, source: "whatsapp" },
    { dayOffset: -96, hour: 14, customerIdx: 3, serviceId: botox.id, professionalId: carolina.id, status: "completed", paid: true },
    { dayOffset: -84, hour: 9, customerIdx: 1, serviceId: drenagem.id, professionalId: juliana.id, status: "completed", paid: true },
    { dayOffset: -70, hour: 15, customerIdx: 5, serviceId: limpeza.id, professionalId: ana.id, status: "completed", paid: true, source: "ai" },
    { dayOffset: -63, hour: 11, customerIdx: 0, serviceId: botox.id, professionalId: marianaProf.id, status: "completed", paid: true },
    { dayOffset: -56, hour: 16, customerIdx: 7, serviceId: massagem.id, professionalId: juliana.id, status: "completed", paid: true },
    { dayOffset: -49, hour: 10, customerIdx: 11, serviceId: hifu.id, professionalId: carolina.id, status: "completed", resourceId: hifuEquip.id, paid: true, source: "ai" },
    { dayOffset: -42, hour: 13, customerIdx: 2, serviceId: limpeza.id, professionalId: ana.id, status: "completed", paid: true, source: "public" },
    { dayOffset: -35, hour: 9, customerIdx: 9, serviceId: laser.id, professionalId: ana.id, status: "completed", resourceId: laserEquip.id, paid: true, source: "whatsapp" },
    { dayOffset: -28, hour: 14, customerIdx: 4, serviceId: drenagem.id, professionalId: juliana.id, status: "completed", paid: true },
    { dayOffset: -21, hour: 15, customerIdx: 6, serviceId: limpeza.id, professionalId: ana.id, status: "completed", paid: true },
    { dayOffset: -21, hour: 11, customerIdx: 13, serviceId: botox.id, professionalId: marianaProf.id, status: "completed", paid: true },
    { dayOffset: -14, hour: 10, customerIdx: 15, serviceId: massagem.id, professionalId: juliana.id, status: "completed", paid: true, source: "whatsapp" },
    { dayOffset: -14, hour: 16, customerIdx: 10, serviceId: limpeza.id, professionalId: ana.id, status: "no_show" },
    { dayOffset: -10, hour: 9, customerIdx: 12, serviceId: laser.id, professionalId: ana.id, status: "completed", resourceId: laserEquip.id, paid: true },
    { dayOffset: -7, hour: 14, customerIdx: 0, serviceId: drenagem.id, professionalId: juliana.id, status: "completed", paid: true },
    { dayOffset: -7, hour: 11, customerIdx: 16, serviceId: limpeza.id, professionalId: carolina.id, status: "cancelled" },
    { dayOffset: -5, hour: 15, customerIdx: 17, serviceId: botox.id, professionalId: carolina.id, status: "completed", paid: true, source: "ai" },
    { dayOffset: -3, hour: 10, customerIdx: 8, serviceId: limpeza.id, professionalId: ana.id, status: "completed", paid: true, source: "public" },
    { dayOffset: -2, hour: 16, customerIdx: 14, serviceId: massagem.id, professionalId: juliana.id, status: "completed", paid: true },

    // --- Hoje (a tela "Hoje" e a agenda precisam contar uma história real) ---
    { dayOffset: 0, hour: 9, customerIdx: 0, serviceId: limpeza.id, professionalId: ana.id, status: "completed", paid: true, source: "whatsapp" },
    { dayOffset: 0, hour: 9, minute: 30, customerIdx: 3, serviceId: botox.id, professionalId: carolina.id, status: "completed", paid: true },
    { dayOffset: 0, hour: 11, customerIdx: 5, serviceId: drenagem.id, professionalId: juliana.id, status: "completed", paid: false },
    { dayOffset: 0, hour: 11, customerIdx: 7, serviceId: laser.id, professionalId: ana.id, status: "in_progress", resourceId: laserEquip.id },
    { dayOffset: 0, hour: 13, customerIdx: 11, serviceId: hifu.id, professionalId: carolina.id, status: "confirmed", resourceId: hifuEquip.id, source: "ai" },
    { dayOffset: 0, hour: 14, customerIdx: 1, serviceId: massagem.id, professionalId: juliana.id, status: "confirmed" },
    { dayOffset: 0, hour: 14, minute: 30, customerIdx: 9, serviceId: limpeza.id, professionalId: ana.id, status: "scheduled", source: "public" },
    { dayOffset: 0, hour: 15, customerIdx: 13, serviceId: botox.id, professionalId: marianaProf.id, status: "confirmed" },
    { dayOffset: 0, hour: 16, customerIdx: 2, serviceId: drenagem.id, professionalId: juliana.id, status: "scheduled", source: "whatsapp" },
    { dayOffset: 0, hour: 16, minute: 30, customerIdx: 15, serviceId: limpeza.id, professionalId: carolina.id, status: "confirmed" },

    // --- Próximos dias ---
    { dayOffset: 1, hour: 9, customerIdx: 4, serviceId: limpeza.id, professionalId: ana.id, status: "scheduled" },
    { dayOffset: 1, hour: 10, minute: 30, customerIdx: 6, serviceId: botox.id, professionalId: carolina.id, status: "confirmed", source: "ai" },
    { dayOffset: 1, hour: 14, customerIdx: 8, serviceId: massagem.id, professionalId: juliana.id, status: "scheduled", source: "whatsapp" },
    { dayOffset: 1, hour: 15, minute: 30, customerIdx: 12, serviceId: hifu.id, professionalId: marianaProf.id, status: "scheduled", resourceId: hifuEquip.id },
    { dayOffset: 2, hour: 9, minute: 30, customerIdx: 10, serviceId: laser.id, professionalId: ana.id, status: "confirmed", resourceId: laserEquip.id },
    { dayOffset: 2, hour: 11, customerIdx: 16, serviceId: drenagem.id, professionalId: juliana.id, status: "scheduled" },
    { dayOffset: 3, hour: 10, customerIdx: 17, serviceId: limpeza.id, professionalId: carolina.id, status: "scheduled", source: "public" },
    { dayOffset: 3, hour: 16, customerIdx: 14, serviceId: botox.id, professionalId: marianaProf.id, status: "confirmed" },
    { dayOffset: 4, hour: 9, customerIdx: 1, serviceId: limpeza.id, professionalId: ana.id, status: "scheduled" },
  ];

  for (const plan of plans) {
    const service = serviceById.get(plan.serviceId)!;
    const customer = insertedCustomers[plan.customerIdx];
    const startsAt = slot(plan.dayOffset, plan.hour, plan.minute ?? 0);
    const endsAt = addMinutes(startsAt, service.durationMin);
    const branchId = plan.branchId ?? tirol.id;

    const [appt] = await db
      .insert(s.appointments)
      .values({
        organizationId: orgId,
        branchId,
        customerId: customer.id,
        professionalId: plan.professionalId,
        serviceId: service.id,
        resourceId: plan.resourceId ?? null,
        startsAt,
        endsAt,
        status: plan.status,
        priceCents: service.priceCents,
        source: plan.source ?? "admin",
        createdByUserId: owner.id,
      })
      .returning();

    await db.insert(s.appointmentHistory).values({
      organizationId: orgId,
      appointmentId: appt.id,
      actorType: plan.source === "ai" ? "ai" : plan.source === "public" ? "public" : "user",
      actorId: owner.id,
      action: "created",
      after: { status: plan.status, startsAt },
    });

    if (plan.status === "completed") {
      const pro = proById.get(plan.professionalId)!;
      const bps = service.commissionBps ?? pro.commissionBps;
      await db.insert(s.commissions).values({
        organizationId: orgId,
        appointmentId: appt.id,
        professionalId: plan.professionalId,
        baseCents: service.priceCents,
        bps,
        amountCents: Math.round((service.priceCents * bps) / 10_000),
      });

      await db
        .update(s.customers)
        .set({
          visitsCount: sql`${s.customers.visitsCount} + 1`,
          totalSpentCents: sql`${s.customers.totalSpentCents} + ${service.priceCents}`,
          lastVisitAt: startsAt,
          firstVisitAt: sql`coalesce(${s.customers.firstVisitAt}, ${startsAt.toISOString()}::timestamptz)`,
        })
        .where(sql`${s.customers.id} = ${customer.id}`);
    }

    if (plan.status === "no_show") {
      await db
        .update(s.customers)
        .set({ noShowCount: sql`${s.customers.noShowCount} + 1` })
        .where(sql`${s.customers.id} = ${customer.id}`);
    }
    if (plan.status === "cancelled") {
      await db
        .update(s.customers)
        .set({ cancellationsCount: sql`${s.customers.cancellationsCount} + 1` })
        .where(sql`${s.customers.id} = ${customer.id}`);
    }

    if (plan.paid) {
      const methods = ["pix", "cartao_credito", "cartao_debito", "dinheiro"] as const;
      const method = methods[appt.id % methods.length];
      const [payment] = await db
        .insert(s.payments)
        .values({
          organizationId: orgId,
          appointmentId: appt.id,
          customerId: customer.id,
          method,
          amountCents: service.priceCents,
          paidAt: startsAt,
          createdByUserId: owner.id,
        })
        .returning();

      await db.insert(s.financialTransactions).values({
        organizationId: orgId,
        branchId,
        kind: "income",
        status: "paid",
        description: `${service.name} — ${customer.name}`,
        amountCents: service.priceCents,
        dueDate: startsAt.toISOString().slice(0, 10),
        paidAt: startsAt,
        paymentId: payment.id,
        appointmentId: appt.id,
        customerId: customer.id,
      });
    }
  }

  // Despesas e recebíveis para o financeiro não nascer vazio
  const [aluguel, insumos, folha] = await db
    .insert(s.financialCategories)
    .values([
      { organizationId: orgId, name: "Aluguel", kind: "expense" },
      { organizationId: orgId, name: "Insumos", kind: "expense" },
      { organizationId: orgId, name: "Folha", kind: "expense" },
    ])
    .returning();

  await db.insert(s.financialTransactions).values([
    { organizationId: orgId, branchId: tirol.id, kind: "expense", status: "paid", description: "Aluguel Tirol — agosto", amountCents: 620000, dueDate: subDays(now, 12).toISOString().slice(0, 10), paidAt: subDays(now, 12), categoryId: aluguel.id },
    { organizationId: orgId, branchId: pontaNegra.id, kind: "expense", status: "paid", description: "Aluguel Ponta Negra — agosto", amountCents: 480000, dueDate: subDays(now, 12).toISOString().slice(0, 10), paidAt: subDays(now, 12), categoryId: aluguel.id },
    { organizationId: orgId, branchId: tirol.id, kind: "expense", status: "pending", description: "Reposição de ácido hialurônico", amountCents: 187000, dueDate: addDays(now, 4).toISOString().slice(0, 10), categoryId: insumos.id },
    { organizationId: orgId, branchId: tirol.id, kind: "expense", status: "overdue", description: "Manutenção do Ultraformer", amountCents: 95000, dueDate: subDays(now, 3).toISOString().slice(0, 10), categoryId: insumos.id },
    { organizationId: orgId, branchId: tirol.id, kind: "expense", status: "pending", description: "Folha de pagamento — agosto", amountCents: 1840000, dueDate: addDays(now, 8).toISOString().slice(0, 10), categoryId: folha.id },
    { organizationId: orgId, branchId: tirol.id, kind: "income", status: "pending", description: "Protocolo HIFU — 2ª parcela (Rafaela Pinheiro)", amountCents: 125000, dueDate: addDays(now, 6).toISOString().slice(0, 10), customerId: insertedCustomers[11].id },
    { organizationId: orgId, branchId: tirol.id, kind: "income", status: "overdue", description: "Pacote de drenagem — 3ª parcela (Camila Bezerra)", amountCents: 54000, dueDate: subDays(now, 2).toISOString().slice(0, 10), customerId: insertedCustomers[4].id },
  ]);

  // Agente de IA (desligado por padrão — o dono liga quando quiser)
  await db.insert(s.aiAgents).values({
    organizationId: orgId,
    name: "Sofia",
    enabled: false,
    instructions:
      "Você é a recepcionista digital da Clínica Lumina. Responde com clareza e simpatia, sem exageros. " +
      "Nunca informe preço, horário ou disponibilidade sem consultar as ferramentas. " +
      "Se não souber, transfira para a equipe.",
    config: { handoffAfterMinutes: 10, workingHoursOnly: true },
  });

  const [conversa] = await db
    .insert(s.conversations)
    .values({
      organizationId: orgId,
      customerId: insertedCustomers[8].id, // Marcela Guedes — a mesma citada nas mensagens
      channel: "whatsapp",
      controlledBy: "human",
      status: "open",
      lastMessageAt: addMinutes(now, -12),
    })
    .returning();

  await db.insert(s.messages).values([
    { organizationId: orgId, conversationId: conversa.id, direction: "inbound", sender: "customer", body: "Oi! Vocês fazem limpeza de pele?", createdAt: addMinutes(now, -18) },
    { organizationId: orgId, conversationId: conversa.id, direction: "outbound", sender: "user", body: "Olá, Marcela! Fazemos sim. A limpeza de pele profunda dura 1h30 e custa R$ 280.", createdAt: addMinutes(now, -15) },
    { organizationId: orgId, conversationId: conversa.id, direction: "inbound", sender: "customer", body: "Perfeito. Tem horário quinta à tarde?", createdAt: addMinutes(now, -12) },
  ]);

  const counts = await db.execute(sql`
    select
      (select count(*) from customers) as clientes,
      (select count(*) from appointments) as atendimentos,
      (select count(*) from payments) as pagamentos,
      (select count(*) from commissions) as comissoes
  `);
  console.log("Clínica Lumina criada:", counts.rows[0]);
  anunciarAcesso();
}

// A senha só é útil se quem rodou o seed a enxergar.
function anunciarAcesso() {
  console.log("");
  console.log("  Demonstração criada.");
  console.log("    login: mariana@clinicalumina.com.br");
  console.log(`    senha: ${DEMO_PASSWORD}`);
  console.log("  Anote: ela é sorteada a cada seed e não fica gravada em lugar nenhum.");
  console.log("");
}

main()
  .then(() => pool.end())
  .catch((error) => {
    console.error(error);
    pool.end();
    process.exit(1);
  });