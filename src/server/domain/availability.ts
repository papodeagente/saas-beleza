import { addMinutes } from "date-fns";
import { localDateTimeToUtc, weekdayInTz } from "@/lib/tz";

/**
 * Núcleo de disponibilidade — FUNÇÃO PURA, sem I/O.
 *
 * Fonte única de verdade consumida por: agenda admin, página pública de
 * agendamento, tools do agente de IA e API. Nunca duplicar esta lógica.
 */

export type Interval = { start: Date; end: Date };

export type WorkingWindow = {
  professionalId: number;
  branchId: number;
  /** 0 = domingo … 6 = sábado, no fuso do tenant */
  weekday: number;
  /** "HH:mm" ou "HH:mm:ss" no fuso do tenant */
  startTime: string;
  endTime: string;
};

export type BusyInterval = Interval & {
  professionalId: number;
  resourceId: number | null;
};

export type ResourceRef = { id: number; branchId: number; type: string };

export type ServiceSpec = {
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minLeadMinutes: number;
  maxLeadDays: number;
  requiredResourceType: string | null;
};

export type ComputeSlotsInput = {
  /** dia local do tenant, yyyy-MM-dd */
  dateISO: string;
  timezone: string;
  now: Date;
  service: ServiceSpec;
  professionalIds: number[];
  workingWindows: WorkingWindow[];
  /**
   * Compromissos já existentes, JÁ EXPANDIDOS com os buffers do próprio serviço
   * (responsabilidade de quem carrega os dados — ver AvailabilityService).
   * O candidato expande com os seus buffers, então entre dois atendimentos
   * sobra buffer_after(A) + buffer_before(B), como na operação real.
   */
  busy: BusyInterval[];
  blocks: Array<Interval & { professionalId: number }>;
  resources: ResourceRef[];
  /** granularidade da grade de horários, em minutos */
  granularityMin?: number;
  /** quando informado, restringe a uma unidade */
  branchId?: number;
};

export type Slot = {
  start: Date;
  end: Date;
  professionalId: number;
  branchId: number;
  resourceId: number | null;
};

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

function parseHHmm(value: string): { h: number; m: number } {
  const [h, m] = value.split(":");
  return { h: Number(h), m: Number(m) };
}

/**
 * Calcula os horários livres para um serviço num dia.
 *
 * Considera: grade do profissional, atendimentos existentes (com buffers dos
 * dois lados), bloqueios/férias, conflito de sala/equipamento, antecedência
 * mínima e máxima.
 */
export function computeAvailableSlots(input: ComputeSlotsInput): Slot[] {
  const {
    dateISO,
    timezone,
    now,
    service,
    professionalIds,
    workingWindows,
    busy,
    blocks,
    resources,
    granularityMin = 15,
    branchId,
  } = input;

  const dayStartUtc = localDateTimeToUtc(dateISO, "00:00", timezone);
  const weekday = weekdayInTz(dayStartUtc, timezone);

  const earliest = addMinutes(now, service.minLeadMinutes);
  const latest = addMinutes(now, service.maxLeadDays * 24 * 60);

  const slots: Slot[] = [];

  for (const professionalId of professionalIds) {
    const windows = workingWindows.filter(
      (w) =>
        w.professionalId === professionalId &&
        w.weekday === weekday &&
        (branchId === undefined || w.branchId === branchId),
    );

    for (const window of windows) {
      const { h: startH, m: startM } = parseHHmm(window.startTime);
      const { h: endH, m: endM } = parseHHmm(window.endTime);
      const windowStart = localDateTimeToUtc(
        dateISO,
        `${String(startH).padStart(2, "0")}:${String(startM).padStart(2, "0")}`,
        timezone,
      );
      const windowEnd = localDateTimeToUtc(
        dateISO,
        `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`,
        timezone,
      );

      for (
        let start = windowStart;
        addMinutes(start, service.durationMin) <= windowEnd;
        start = addMinutes(start, granularityMin)
      ) {
        const end = addMinutes(start, service.durationMin);

        // Antecedência mínima e máxima
        if (start < earliest || start > latest) continue;

        // O intervalo realmente ocupado inclui os buffers de preparo/limpeza
        const occupied: Interval = {
          start: addMinutes(start, -service.bufferBeforeMin),
          end: addMinutes(end, service.bufferAfterMin),
        };

        const professionalBusy = busy.some(
          (b) => b.professionalId === professionalId && overlaps(occupied, b),
        );
        if (professionalBusy) continue;

        const blocked = blocks.some(
          (b) => b.professionalId === professionalId && overlaps(occupied, b),
        );
        if (blocked) continue;

        // Recurso (sala/cabine/equipamento), quando o serviço exige
        let resourceId: number | null = null;
        if (service.requiredResourceType) {
          const candidates = resources.filter(
            (r) => r.type === service.requiredResourceType && r.branchId === window.branchId,
          );
          const free = candidates.find(
            (r) => !busy.some((b) => b.resourceId === r.id && overlaps(occupied, b)),
          );
          if (!free) continue;
          resourceId = free.id;
        }

        slots.push({ start, end, professionalId, branchId: window.branchId, resourceId });
      }
    }
  }

  return slots.sort((a, b) => a.start.getTime() - b.start.getTime() || a.professionalId - b.professionalId);
}

/** Agrupa slots por horário — a UI mostra "14:30" uma vez, com os profissionais disponíveis. */
export function groupSlotsByTime(slots: Slot[]): Array<{ start: Date; end: Date; options: Slot[] }> {
  const map = new Map<number, Slot[]>();
  for (const slot of slots) {
    const key = slot.start.getTime();
    const list = map.get(key);
    if (list) list.push(slot);
    else map.set(key, [slot]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([time, options]) => ({ start: new Date(time), end: options[0].end, options }));
}
