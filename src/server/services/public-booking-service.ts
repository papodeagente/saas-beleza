import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  branches,
  customers,
  organizations,
  professionalServices,
  professionals,
  serviceCategories,
  services,
} from "@/db/schema";
import { normalizePhone } from "@/lib/phone";
import type { TenantContext } from "@/server/auth";
import { getAccountAccess } from "./account-access";
import { createAppointment } from "./appointment-service";
import {
  getAvailableSlots,
  getAvailableSlotsByDay,
} from "./availability-service";
import { quantosHorariosVisiveis } from "@/app/agendar/[slug]/horarios";
import { formatTz } from "@/lib/tz";

/**
 * Agendamento público — o cliente final não tem sessão, então o contexto de
 * tenant é derivado do slug da organização e o acesso fica restrito ao que é
 * explicitamente publicável (`online_booking`, unidades e profissionais ativos).
 */

export type PublicOrganization = {
  ctx: TenantContext;
  organization: { id: number; name: string; slug: string; timezone: string };
  branches: Array<{ id: number; name: string; address: string | null; phone: string | null }>;
  services: Array<{
    id: number;
    name: string;
    description: string | null;
    durationMin: number;
    priceCents: number;
    categoryName: string | null;
    /**
     * Até quantos dias à frente este serviço aceita marcação.
     *
     * A tela precisa saber para não deixar a cliente navegar o calendário até
     * um mês que nunca terá horário: um mês vazio por regra parece agenda
     * cheia. Varia de verdade entre serviços desta base — de 45 a 120 dias.
     */
    maxLeadDays: number;
  }>;
};

/** Contexto de sistema: sem usuário, com organizationId vindo do slug público. */
function publicContext(org: typeof organizations.$inferSelect): TenantContext {
  return {
    organizationId: org.id,
    organizationName: org.name,
    organizationSlug: org.slug,
    organizationCode: org.publicId,
    timezone: org.timezone,
    userId: 0,
    userName: "Agendamento online",
    userEmail: "",
    role: "staff",
  };
}

/**
 * Existe a conta, independentemente de ela poder vender hoje.
 *
 * Serve para a página distinguir "link errado" (404) de "agenda fora do ar no
 * momento" — que são coisas diferentes para quem clicou num panfleto.
 */
export async function publicOrganizationExists(slug: string): Promise<boolean> {
  const [row] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  return Boolean(row);
}

export async function getPublicOrganization(slug: string): Promise<PublicOrganization | null> {
  const [org] = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
  if (!org) return null;

  /**
   * O portão comercial vale no caminho público também.
   *
   * `getAccountAccess` já existia e já resolvia suspensão, teste vencido e
   * cancelamento com período encerrado — mas era chamada só nos caminhos
   * autenticados. O resultado é que uma conta suspensa por inadimplência
   * perdia o painel e mantinha `/agendar/[slug]` no ar: a cliente marcava
   * horário com alguém que não ia ver o agendamento, e a plataforma seguia
   * vendendo publicamente a agenda de quem não paga.
   *
   * A checagem mora AQUI, e não em cada chamador, porque este é o funil por
   * onde passam a página, as três Server Actions públicas e tudo que o
   * marketplace vier a ler. Um portão que se pode esquecer de abrir não é
   * portão.
   */
  const acesso = await getAccountAccess(org.id);
  if (!acesso.allowed) return null;

  const [branchRows, serviceRows] = await Promise.all([
    db
      .select({ id: branches.id, name: branches.name, address: branches.address, phone: branches.phone })
      .from(branches)
      .where(and(eq(branches.organizationId, org.id), eq(branches.active, true)))
      .orderBy(asc(branches.name)),
    db
      .select({
        id: services.id,
        name: services.name,
        description: services.description,
        durationMin: services.durationMin,
        priceCents: services.priceCents,
        categoryName: serviceCategories.name,
        maxLeadDays: services.maxLeadDays,
      })
      .from(services)
      .leftJoin(serviceCategories, eq(serviceCategories.id, services.categoryId))
      .where(
        and(
          eq(services.organizationId, org.id),
          eq(services.active, true),
          eq(services.onlineBooking, true),
        ),
      )
      .orderBy(asc(serviceCategories.position), asc(services.name)),
  ]);

  return {
    ctx: publicContext(org),
    organization: { id: org.id, name: org.name, slug: org.slug, timezone: org.timezone },
    branches: branchRows,
    services: serviceRows,
  };
}

export async function getPublicProfessionals(ctx: TenantContext, serviceId: number) {
  return db
    .select({ id: professionals.id, name: professionals.name, specialty: professionals.specialty })
    .from(professionalServices)
    .innerJoin(professionals, eq(professionals.id, professionalServices.professionalId))
    .where(
      and(
        eq(professionalServices.organizationId, ctx.organizationId),
        eq(professionalServices.serviceId, serviceId),
        eq(professionals.active, true),
      ),
    )
    .orderBy(asc(professionals.name));
}

export type PublicSlot = {
  startsAt: string;
  label: string;
  professionalId: number;
  professionalName: string;
  branchId: number;
  resourceId: number | null;
};

export type PublicAvailableDay = { dateISO: string; slotCount: number };

/** Dias que realmente têm pelo menos um horário, para a cliente não precisar
 * abrir datas vazias uma por uma. */
export async function getPublicAvailableDays(
  slug: string,
  input: { serviceId: number; dateISOs: string[]; branchId?: number },
): Promise<PublicAvailableDay[]> {
  const org = await getPublicOrganization(slug);
  if (!org || !org.services.some((service) => service.id === input.serviceId)) return [];

  // UMA busca para o intervalo inteiro. Dia a dia eram seis idas ao banco por
  // dia — um mês custava 186 viagens e até 2,5 segundos, o que inviabilizava
  // navegar entre meses no calendário.
  const porDia = await getAvailableSlotsByDay(org.ctx, {
    serviceId: input.serviceId,
    dateISOs: input.dateISOs,
    branchId: input.branchId,
  });

  const rows = await Promise.all(
    input.dateISOs.map(async (dateISO) => {
      const slots = porDia.get(dateISO) ?? [];
      /**
       * A contagem é a dos horários que a tela VAI MOSTRAR, não a dos instantes
       * que a agenda tem.
       *
       * A cliente escolhe por etiqueta ("09:30"), não por instante: dois
       * profissionais livres às 09:30 são uma escolha só. E acima de 20 opções
       * a grade dobra o passo para 30 minutos. Contando cru, a fita anunciava
       * "31 horários livres" e a grade logo abaixo desenhava 16 — a mesma tela
       * dizendo dois números, e o leitor de tela lendo os dois.
       */
      const etiquetas = [
        ...new Set(slots.map((slot) => formatTz(slot.start, org.ctx.timezone, "HH:mm"))),
      ];
      return { dateISO, slotCount: quantosHorariosVisiveis(etiquetas) };
    }),
  );
  return rows.filter((row) => row.slotCount > 0);
}

export async function getPublicSlots(
  slug: string,
  input: { serviceId: number; dateISO: string; professionalId?: number; branchId?: number },
): Promise<PublicSlot[]> {
  const org = await getPublicOrganization(slug);
  if (!org) return [];

  // O serviço precisa estar publicado — não basta existir
  const publishable = org.services.some((s) => s.id === input.serviceId);
  if (!publishable) return [];

  const [slots, pros] = await Promise.all([
    getAvailableSlots(org.ctx, input),
    getPublicProfessionals(org.ctx, input.serviceId),
  ]);
  const nameById = new Map(pros.map((p) => [p.id, p.name]));

  return slots.map((slot) => ({
    startsAt: slot.start.toISOString(),
    label: formatTz(slot.start, org.ctx.timezone, "HH:mm"),
    professionalId: slot.professionalId,
    professionalName: nameById.get(slot.professionalId) ?? "",
    branchId: slot.branchId,
    resourceId: slot.resourceId,
  }));
}

export type PublicBookingInput = {
  slug: string;
  serviceId: number;
  startsAt: string;
  professionalId: number;
  branchId: number;
  resourceId: number | null;
  name: string;
  phone: string;
  email?: string | null;
  /** Opt-in explícito de marketing. Ausente ou falso nunca revoga um consentimento já dado. */
  consentMarketing?: boolean;
};

export type PublicBookingResult = {
  appointmentId: number;
  serviceName: string;
  professionalName: string;
  branchName: string;
  branchAddress: string | null;
  startsAt: Date;
};

/**
 * Cria (ou reaproveita) o cliente pelo telefone e agenda.
 * O cliente final não cria conta — o telefone é a identidade.
 */
export async function createPublicBooking(input: PublicBookingInput): Promise<PublicBookingResult> {
  const org = await getPublicOrganization(input.slug);
  if (!org) throw new Error("ORGANIZATION_NOT_FOUND");

  const service = org.services.find((s) => s.id === input.serviceId);
  if (!service) throw new Error("SERVICE_NOT_AVAILABLE");

  const phone = normalizePhone(input.phone);
  const [existing] = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(and(eq(customers.organizationId, org.ctx.organizationId), eq(customers.phone, phone)))
    .limit(1);

  let customerId: number;
  if (existing) {
    customerId = existing.id;
    // Não sobrescreve o nome de um cliente já cadastrado: quem manda é a ficha.
    // O consentimento só sobe (opt-in); desmarcar aqui não revoga o que já foi dado.
    const patch: { email?: ReturnType<typeof sql>; consentMarketing?: boolean } = {};
    if (input.email) patch.email = sql`coalesce(${customers.email}, ${input.email})`;
    if (input.consentMarketing) patch.consentMarketing = true;
    if (Object.keys(patch).length > 0) {
      await db.update(customers).set(patch).where(eq(customers.id, existing.id));
    }
  } else {
    const [created] = await db
      .insert(customers)
      .values({
        organizationId: org.ctx.organizationId,
        name: input.name.trim(),
        phone,
        email: input.email?.trim() || null,
        source: "public_booking",
        preferredBranchId: input.branchId,
        consentMarketing: input.consentMarketing === true,
      })
      .returning({ id: customers.id });
    customerId = created.id;
  }

  const appointment = await createAppointment(org.ctx, {
    customerId,
    serviceId: input.serviceId,
    professionalId: input.professionalId,
    branchId: input.branchId,
    startsAt: new Date(input.startsAt),
    resourceId: input.resourceId,
    source: "public",
  });

  const [professional] = await db
    .select({ name: professionals.name })
    .from(professionals)
    .where(eq(professionals.id, input.professionalId))
    .limit(1);
  const [branch] = await db
    .select({ name: branches.name, address: branches.address })
    .from(branches)
    .where(eq(branches.id, input.branchId))
    .limit(1);

  return {
    appointmentId: appointment.id,
    serviceName: service.name,
    professionalName: professional?.name ?? "",
    branchName: branch?.name ?? "",
    branchAddress: branch?.address ?? null,
    startsAt: appointment.startsAt,
  };
}
