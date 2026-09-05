import { describe, expect, it } from "vitest";
import { describeDay, sortRanges, validateDayRanges } from "./working-hours";

describe("validateDayRanges", () => {
  it("aceita o dia partido em dois turnos", () => {
    expect(
      validateDayRanges([
        { startTime: "09:00", endTime: "12:00" },
        { startTime: "14:00", endTime: "18:00" },
      ]),
    ).toBeNull();
  });

  it("aceita turnos encostados", () => {
    expect(
      validateDayRanges([
        { startTime: "09:00", endTime: "12:00" },
        { startTime: "12:00", endTime: "18:00" },
      ]),
    ).toBeNull();
  });

  it("recusa período invertido", () => {
    expect(validateDayRanges([{ startTime: "18:00", endTime: "09:00" }])).toMatch(/depois do início/);
  });

  it("recusa sobreposição mesmo fora de ordem", () => {
    expect(
      validateDayRanges([
        { startTime: "14:00", endTime: "18:00" },
        { startTime: "10:00", endTime: "15:00" },
      ]),
    ).toMatch(/sobrepostos/);
  });

  it("recusa hora impossível", () => {
    expect(validateDayRanges([{ startTime: "25:00", endTime: "26:00" }])).toMatch(/formato 24h/);
  });

  it("aceita o formato time do banco, com segundos", () => {
    expect(validateDayRanges([{ startTime: "09:00:00", endTime: "18:00:00" }])).toBeNull();
  });
});

describe("apresentação", () => {
  it("ordena por início", () => {
    const ordered = sortRanges([
      { startTime: "14:00", endTime: "18:00" },
      { startTime: "09:00", endTime: "12:00" },
    ]);
    expect(ordered[0].startTime).toBe("09:00");
  });

  it("descreve o dia sem segundos", () => {
    expect(describeDay([{ startTime: "09:00:00", endTime: "18:00:00" }])).toBe("09:00–18:00");
    expect(describeDay([])).toBe("Não atende");
  });
});
