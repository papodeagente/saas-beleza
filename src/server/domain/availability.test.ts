import { describe, expect, it } from "vitest";
import { localDateTimeToUtc } from "@/lib/tz";
import { computeAvailableSlots, type ComputeSlotsInput } from "./availability";

const TZ = "America/Sao_Paulo";
const DATE = "2026-09-15"; // terça-feira
const at = (hhmm: string) => localDateTimeToUtc(DATE, hhmm, TZ);

function baseInput(overrides: Partial<ComputeSlotsInput> = {}): ComputeSlotsInput {
  return {
    dateISO: DATE,
    timezone: TZ,
    now: at("06:00"),
    service: {
      durationMin: 60,
      bufferBeforeMin: 0,
      bufferAfterMin: 0,
      minLeadMinutes: 0,
      maxLeadDays: 60,
      requiredResourceType: null,
    },
    professionalIds: [1],
    workingWindows: [{ professionalId: 1, branchId: 10, weekday: 2, startTime: "09:00", endTime: "12:00" }],
    busy: [],
    blocks: [],
    resources: [],
    granularityMin: 15,
    ...overrides,
  };
}

const times = (input: ComputeSlotsInput) =>
  computeAvailableSlots(input).map((s) => s.start.toISOString());

describe("computeAvailableSlots", () => {
  it("gera slots na granularidade dentro da janela de trabalho", () => {
    const result = computeAvailableSlots(baseInput());
    // 09:00 → 11:00 (último início que ainda cabe 60min antes das 12:00)
    expect(result).toHaveLength(9);
    expect(result[0].start).toEqual(at("09:00"));
    expect(result.at(-1)!.start).toEqual(at("11:00"));
  });

  it("não gera slots em dia sem grade do profissional", () => {
    // weekday 3 = quarta; o dia testado é terça
    const input = baseInput({
      workingWindows: [{ professionalId: 1, branchId: 10, weekday: 3, startTime: "09:00", endTime: "18:00" }],
    });
    expect(computeAvailableSlots(input)).toHaveLength(0);
  });

  it("remove horários que colidem com atendimento existente", () => {
    const input = baseInput({
      busy: [{ professionalId: 1, resourceId: null, start: at("10:00"), end: at("11:00") }],
    });
    const result = times(input);
    expect(result).not.toContain(at("09:30").toISOString()); // terminaria 10:30, colide
    expect(result).not.toContain(at("10:00").toISOString());
    expect(result).toContain(at("09:00").toISOString()); // termina exatamente às 10:00
    expect(result).toContain(at("11:00").toISOString()); // começa quando o outro termina
  });

  it("aplica buffers de preparo e limpeza dos dois lados", () => {
    const input = baseInput({
      workingWindows: [{ professionalId: 1, branchId: 10, weekday: 2, startTime: "09:00", endTime: "13:00" }],
      service: { ...baseInput().service, bufferBeforeMin: 15, bufferAfterMin: 15 },
      busy: [{ professionalId: 1, resourceId: null, start: at("10:00"), end: at("11:00") }],
    });
    const result = times(input);
    // 09:00–10:00 + buffer de 15min de limpeza invade o atendimento das 10:00
    expect(result).not.toContain(at("09:00").toISOString());
    // 11:00 exigiria preparo a partir de 10:45, ainda dentro do atendimento anterior
    expect(result).not.toContain(at("11:00").toISOString());
    // o primeiro horário que respeita o preparo é 11:15
    expect(result).toContain(at("11:15").toISOString());
  });

  it("exige buffer entre dois atendimentos consecutivos do mesmo profissional", () => {
    // O atendimento existente já chega expandido com o próprio buffer (10:00–11:15).
    const input = baseInput({
      workingWindows: [{ professionalId: 1, branchId: 10, weekday: 2, startTime: "09:00", endTime: "13:00" }],
      service: { ...baseInput().service, bufferBeforeMin: 15, bufferAfterMin: 15 },
      busy: [{ professionalId: 1, resourceId: null, start: at("10:00"), end: at("11:15") }],
    });
    const result = times(input);
    expect(result).not.toContain(at("11:15").toISOString());
    expect(result).toContain(at("11:30").toISOString());
  });

  it("respeita bloqueios de agenda (férias, almoço)", () => {
    const input = baseInput({
      blocks: [{ professionalId: 1, start: at("09:00"), end: at("10:30") }],
    });
    const result = times(input);
    expect(result[0]).toBe(at("10:30").toISOString());
  });

  it("respeita antecedência mínima", () => {
    const input = baseInput({
      now: at("08:00"),
      service: { ...baseInput().service, minLeadMinutes: 120 },
    });
    // Só a partir das 10:00
    expect(times(input)[0]).toBe(at("10:00").toISOString());
  });

  it("respeita antecedência máxima", () => {
    const input = baseInput({
      now: localDateTimeToUtc("2026-09-01", "08:00", TZ),
      service: { ...baseInput().service, maxLeadDays: 3 },
    });
    expect(computeAvailableSlots(input)).toHaveLength(0);
  });

  it("exige recurso livre quando o serviço depende de sala/equipamento", () => {
    const input = baseInput({
      service: { ...baseInput().service, requiredResourceType: "equipment" },
      resources: [{ id: 99, branchId: 10, type: "equipment" }],
      busy: [{ professionalId: 2, resourceId: 99, start: at("09:00"), end: at("10:00") }],
    });
    const result = computeAvailableSlots(input);
    // O profissional 1 está livre, mas o equipamento está ocupado por outro profissional
    expect(result.map((s) => s.start.toISOString())).not.toContain(at("09:00").toISOString());
    expect(result[0].start).toEqual(at("10:00"));
    expect(result[0].resourceId).toBe(99);
  });

  it("não oferece horário quando não há nenhum recurso do tipo exigido", () => {
    const input = baseInput({
      service: { ...baseInput().service, requiredResourceType: "equipment" },
      resources: [],
    });
    expect(computeAvailableSlots(input)).toHaveLength(0);
  });

  it("usa o segundo equipamento quando o primeiro está ocupado", () => {
    const input = baseInput({
      service: { ...baseInput().service, requiredResourceType: "equipment" },
      resources: [
        { id: 99, branchId: 10, type: "equipment" },
        { id: 100, branchId: 10, type: "equipment" },
      ],
      busy: [{ professionalId: 2, resourceId: 99, start: at("09:00"), end: at("10:00") }],
    });
    const result = computeAvailableSlots(input);
    expect(result[0].start).toEqual(at("09:00"));
    expect(result[0].resourceId).toBe(100);
  });

  it("combina disponibilidade de vários profissionais no mesmo horário", () => {
    const input = baseInput({
      professionalIds: [1, 2],
      workingWindows: [
        { professionalId: 1, branchId: 10, weekday: 2, startTime: "09:00", endTime: "10:00" },
        { professionalId: 2, branchId: 10, weekday: 2, startTime: "09:00", endTime: "10:00" },
      ],
    });
    const result = computeAvailableSlots(input);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.professionalId)).toEqual([1, 2]);
  });

  it("filtra por unidade quando informada", () => {
    const input = baseInput({
      workingWindows: [
        { professionalId: 1, branchId: 10, weekday: 2, startTime: "09:00", endTime: "10:00" },
        { professionalId: 1, branchId: 20, weekday: 2, startTime: "14:00", endTime: "15:00" },
      ],
      branchId: 20,
    });
    const result = computeAvailableSlots(input);
    expect(result).toHaveLength(1);
    expect(result[0].branchId).toBe(20);
  });

  it("ignora atendimento de outro profissional na mesma sala compartilhada", () => {
    const input = baseInput({
      busy: [{ professionalId: 2, resourceId: null, start: at("09:00"), end: at("12:00") }],
    });
    // Sem recurso exigido, a agenda de outro profissional não bloqueia
    expect(computeAvailableSlots(input)).toHaveLength(9);
  });
});
