import "server-only";
import { addMinutes } from "date-fns";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import {
  appointments,
  professionalServices,
  professionalWorkingHours,
  professionals,
  resources,
  scheduleBlocks,
  services,
} from "@/db/schema";
import { ACTIVE_STATUSES } from "@/domain/appointment-status";
import { dayRangeInTz } from "@/lib/tz";
import type { TenantContext } from "@/server/auth";
import {
  type BusyInterval,
  type Slot,
  computeAvailableSlots,
  groupSlotsByTime,
} from "@/server/domain/availability";

export type SlotQuery = {
  serviceId: number;
  dateISO: string;
  branchId?: number;
  professionalId?: number;
};

/**
 * Fonte única de disponibilidade (I/O). Carrega os dados do tenant e delega
 * o cálculo à função pura. Consumido por agenda admin, booking público,
 * tools da IA e API — nunca reimplementar.
 */
export async function getAvailableSlots(ctx: TenantContext, query: SlotQuery): Promise<Slot[]> {
  const [service] = await db
    .select()
    .from(services)
    .where(and(eq(services.id, query.serviceId), eq(services.organizationId, ctx.organizationId)))
    .limit(1);
  if (!service) return [];

  // Profissionais habilitados para o serviço
  const eligible = await db
    .select({ id: professionals.id })
    .from(professionalServices)
    .innerJoin(professionals, eq(professionals.id, professionalServices.professionalId))
    .where(
      and(
        eq(professionalServices.organizationId, ctx.organizationId),
        eq(professionalServices.serviceId, query.serviceId),
        eq(professionals.active, true),
        query.professionalId ? eq(professionals.id, query.professionalId) : undefined,
      ),
    );
  const professionalIds = eligible.map((p) => p.id);
  if (professionalIds.length === 0) return [];

  const { start: dayStart, end: dayEnd } = dayRangeInTz(new Date(`${query.dateISO}T12:00:00Z`), ctx.timezone);
  // Margem para capturar compromissos que invadem o dia pelas bordas (buffers longos)
  const windowStart = addMinutes(dayStart, -240);
  const windowEnd = addMinutes(dayEnd, 240);

  const [windows, existing, blocks, resourceRows] = await Promise.all([
    db
      .select()
      .from(professionalWorkingHours)
      .where(
        and(
          eq(professionalWorkingHours.organizationId, ctx.organizationId),
          inArray(professionalWorkingHours.professionalId, professionalIds),
        ),
      ),
    // Ocupação do dia: inclui atendimentos de QUALQUER profissional, porque um
    // recurso (sala/equipamento) pode estar preso a outro profissional.
    db
      .select({
        professionalId: appointments.professionalId,
        resourceId: appointments.resourceId,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        bufferBeforeMin: services.bufferBeforeMin,
        bufferAfterMin: services.bufferAfterMin,
      })
      .from(appointments)
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .where(
        and(
          eq(appointments.organizationId, ctx.organizationId),
          inArray(appointments.status, [...ACTIVE_STATUSES]),
          lt(appointments.startsAt, windowEnd),
          gte(appointments.endsAt, windowStart),
        ),
      ),
    db
      .select()
      .from(scheduleBlocks)
      .where(
        and(
          eq(scheduleBlocks.organizationId, ctx.organizationId),
          inArray(scheduleBlocks.professionalId, professionalIds),
          lt(scheduleBlocks.startsAt, windowEnd),
          gte(scheduleBlocks.endsAt, windowStart),
        ),
      ),
    db
      .select()
      .from(resources)
      .where(and(eq(resources.organizationId, ctx.organizationId), eq(resources.active, true))),
  ]);

  // Expande cada compromisso com os buffers do próprio serviço
  const busy: BusyInterval[] = existing.map((a) => ({
    professionalId: a.professionalId,
    resourceId: a.resourceId,
    start: addMinutes(a.startsAt, -a.bufferBeforeMin),
    end: addMinutes(a.endsAt, a.bufferAfterMin),
  }));

  return computeAvailableSlots({
    dateISO: query.dateISO,
    timezone: ctx.timezone,
    now: new Date(),
    service: {
      durationMin: service.durationMin,
      bufferBeforeMin: service.bufferBeforeMin,
      bufferAfterMin: service.bufferAfterMin,
      minLeadMinutes: service.minLeadMinutes,
      maxLeadDays: service.maxLeadDays,
      requiredResourceType: service.requiredResourceType,
    },
    professionalIds,
    workingWindows: windows.map((w) => ({
      professionalId: w.professionalId,
      branchId: w.branchId,
      weekday: w.weekday,
      startTime: w.startTime,
      endTime: w.endTime,
    })),
    busy,
    blocks: blocks.map((b) => ({ professionalId: b.professionalId, start: b.startsAt, end: b.endsAt })),
    resources: resourceRows.map((r) => ({ id: r.id, branchId: r.branchId, type: r.type })),
    branchId: query.branchId,
  });
}

export async function getGroupedSlots(ctx: TenantContext, query: SlotQuery) {
  return groupSlotsByTime(await getAvailableSlots(ctx, query));
}

/** Buracos na agenda de hoje — usado pela home "Hoje" e pela camada de insights. */
export async function countOpenSlotsToday(ctx: TenantContext, dateISO: string): Promise<number> {
  const activeServices = await db
    .select({ id: services.id })
    .from(services)
    .where(and(eq(services.organizationId, ctx.organizationId), eq(services.active, true)))
    .limit(1);
  if (activeServices.length === 0) return 0;
  const slots = await getAvailableSlots(ctx, { serviceId: activeServices[0].id, dateISO });
  return groupSlotsByTime(slots).length;
}

/**
 * Disponibilidade de VÁRIOS dias de uma vez.
 *
 * `getAvailableSlots` faz seis idas ao banco por dia — serviço, profissionais
 * habilitados, jornada, agendamentos, bloqueios e recursos. Chamada num laço
 * para um mês, isso vira 186 viagens até o Postgres: medido, 1,6 a 2,5
 * segundos, e é o que tornava impossível navegar entre meses num calendário.
 *
 * Quatro dessas seis consultas não dependem do dia (a jornada nem sequer tem
 * filtro de data) e as outras duas são recortes de um intervalo. Aqui elas são
 * feitas UMA vez para o intervalo inteiro, e cada dia é calculado em memória
 * pela MESMA função pura `computeAvailableSlots`, com as mesmas entradas — é a
 * regra de disponibilidade intacta, sem uma segunda implementação.
 */
export async function getAvailableSlotsByDay(
  ctx: TenantContext,
  query: {
    serviceId: number;
    dateISOs: string[];
    branchId?: number;
    professionalId?: number;
  },
): Promise<Map<string, Slot[]>> {
  const vazio = new Map<string, Slot[]>();
  if (query.dateISOs.length === 0) return vazio;

  const [service] = await db
    .select()
    .from(services)
    .where(
      and(
        eq(services.id, query.serviceId),
        eq(services.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  if (!service) return vazio;

  const eligible = await db
    .select({ id: professionals.id })
    .from(professionalServices)
    .innerJoin(
      professionals,
      eq(professionals.id, professionalServices.professionalId),
    )
    .where(
      and(
        eq(professionalServices.organizationId, ctx.organizationId),
        eq(professionalServices.serviceId, query.serviceId),
        eq(professionals.active, true),
        query.professionalId
          ? eq(professionals.id, query.professionalId)
          : undefined,
      ),
    );
  const professionalIds = eligible.map((p) => p.id);
  if (professionalIds.length === 0) return vazio;

  // A janela do intervalo inteiro, com a mesma margem de 240min que a consulta
  // de um dia usa para pegar compromisso que invade o dia pelas bordas.
  const limites = query.dateISOs
    .map((dateISO) =>
      dayRangeInTz(new Date(`${dateISO}T12:00:00Z`), ctx.timezone),
    )
    .reduce(
      (acc, r) => ({
        inicio:
          acc.inicio === null || r.start < acc.inicio ? r.start : acc.inicio,
        fim: acc.fim === null || r.end > acc.fim ? r.end : acc.fim,
      }),
      { inicio: null as Date | null, fim: null as Date | null },
    );
  const windowStart = addMinutes(limites.inicio!, -240);
  const windowEnd = addMinutes(limites.fim!, 240);

  const [windows, existing, blocks, resourceRows] = await Promise.all([
    db
      .select()
      .from(professionalWorkingHours)
      .where(
        and(
          eq(professionalWorkingHours.organizationId, ctx.organizationId),
          inArray(professionalWorkingHours.professionalId, professionalIds),
        ),
      ),
    db
      .select({
        professionalId: appointments.professionalId,
        resourceId: appointments.resourceId,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        bufferBeforeMin: services.bufferBeforeMin,
        bufferAfterMin: services.bufferAfterMin,
      })
      .from(appointments)
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .where(
        and(
          eq(appointments.organizationId, ctx.organizationId),
          inArray(appointments.status, [...ACTIVE_STATUSES]),
          lt(appointments.startsAt, windowEnd),
          gte(appointments.endsAt, windowStart),
        ),
      ),
    db
      .select()
      .from(scheduleBlocks)
      .where(
        and(
          eq(scheduleBlocks.organizationId, ctx.organizationId),
          inArray(scheduleBlocks.professionalId, professionalIds),
          lt(scheduleBlocks.startsAt, windowEnd),
          gte(scheduleBlocks.endsAt, windowStart),
        ),
      ),
    db
      .select()
      .from(resources)
      .where(
        and(
          eq(resources.organizationId, ctx.organizationId),
          eq(resources.active, true),
        ),
      ),
  ]);

  const busy: BusyInterval[] = existing.map((a) => ({
    professionalId: a.professionalId,
    resourceId: a.resourceId,
    start: addMinutes(a.startsAt, -a.bufferBeforeMin),
    end: addMinutes(a.endsAt, a.bufferAfterMin),
  }));

  // `now` é lido UMA vez: com um `new Date()` por dia, dois dias vizinhos
  // poderiam discordar sobre a antecedência mínima na virada do minuto.
  const agora = new Date();
  const porDia = new Map<string, Slot[]>();
  for (const dateISO of query.dateISOs) {
    porDia.set(
      dateISO,
      computeAvailableSlots({
        dateISO,
        timezone: ctx.timezone,
        now: agora,
        service: {
          durationMin: service.durationMin,
          bufferBeforeMin: service.bufferBeforeMin,
          bufferAfterMin: service.bufferAfterMin,
          minLeadMinutes: service.minLeadMinutes,
          maxLeadDays: service.maxLeadDays,
          requiredResourceType: service.requiredResourceType,
        },
        professionalIds,
        workingWindows: windows.map((w) => ({
          professionalId: w.professionalId,
          branchId: w.branchId,
          weekday: w.weekday,
          startTime: w.startTime,
          endTime: w.endTime,
        })),
        busy,
        blocks: blocks.map((b) => ({
          professionalId: b.professionalId,
          start: b.startsAt,
          end: b.endsAt,
        })),
        resources: resourceRows.map((r) => ({
          id: r.id,
          branchId: r.branchId,
          type: r.type,
        })),
        branchId: query.branchId,
      }),
    );
  }
  return porDia;
}
