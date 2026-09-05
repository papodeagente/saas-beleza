import { describe, expect, it } from "vitest";
import { dateISOInTz, diasDeCalendarioEmTz, diasDoIntervaloUtc, formatTz } from "./tz";

const NATAL = "America/Sao_Paulo";

describe("hora do salão, não hora de quem renderizou", () => {
  // 26/08/2026 01:30 UTC é 25/08 22:30 em São Paulo. É a noite em que a
  // atendente fecha a caixa, e é onde a tela mentia.
  const noiteDeTerca = new Date("2026-08-26T01:30:00.000Z");

  it("mostra a hora do salão, e não a do relógio do servidor", () => {
    expect(formatTz(noiteDeTerca, NATAL, "HH:mm")).toBe("22:30");
    expect(noiteDeTerca.toISOString().slice(11, 16)).toBe("01:30");
  });

  it("mostra o dia do salão", () => {
    expect(dateISOInTz(noiteDeTerca, NATAL)).toBe("2026-08-25");
  });

  it("chama de HOJE o que ainda é hoje para o salão", () => {
    // Mesma noite, 30 minutos depois: para o UTC já virou o dia.
    const meiaNoiteEMeiaEmUtc = new Date("2026-08-26T02:00:00.000Z");
    expect(diasDeCalendarioEmTz(meiaNoiteEMeiaEmUtc, noiteDeTerca, NATAL)).toBe(0);
  });

  it("conta a virada do dia pelo relógio do salão", () => {
    const quartaDeManha = new Date("2026-08-26T12:00:00.000Z");
    expect(diasDeCalendarioEmTz(quartaDeManha, noiteDeTerca, NATAL)).toBe(1);
  });

  it("atravessa a virada do mês e do ano", () => {
    expect(
      diasDeCalendarioEmTz(
        new Date("2027-01-01T12:00:00.000Z"),
        new Date("2026-12-31T12:00:00.000Z"),
        NATAL,
      ),
    ).toBe(1);
  });

  it("não se confunde com o horário de verão", () => {
    // Última virada brasileira: 04/11/2018. Sete dias de calendário continuam
    // sendo sete, mesmo com uma hora a menos no meio.
    expect(
      diasDeCalendarioEmTz(
        new Date("2018-11-08T15:00:00.000Z"),
        new Date("2018-11-01T15:00:00.000Z"),
        NATAL,
      ),
    ).toBe(7);
  });

  it("vale para fusos diferentes do de São Paulo", () => {
    const meioDiaUtc = new Date("2026-08-26T02:00:00.000Z");
    expect(formatTz(meioDiaUtc, "America/Manaus", "dd/MM HH:mm")).toBe("25/08 22:00");
    expect(formatTz(meioDiaUtc, "America/Sao_Paulo", "dd/MM HH:mm")).toBe("25/08 23:00");
  });
});

describe("dias do intervalo em UTC", () => {
  it("devolve o intervalo inteiro, começo e fim inclusos", () => {
    const dias = diasDoIntervaloUtc("2026-08-23", "2026-08-29");
    expect(dias).toHaveLength(7);
    expect(dias.map((d) => formatTz(d, "UTC", "yyyy-MM-dd"))).toEqual([
      "2026-08-23",
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
      "2026-08-29",
    ]);
  });

  it("ancora ao meio-dia, e não à meia-noite", () => {
    // A meia-noite de um dia é o dia ANTERIOR em UTC para quem está a leste de
    // Greenwich — foi assim que a grade da semana saiu deslocada, "Sábado" no
    // servidor contra "Domingo" no navegador de Lisboa.
    const [primeiro] = diasDoIntervaloUtc("2026-08-23", "2026-08-23");
    expect(primeiro.toISOString()).toBe("2026-08-23T12:00:00.000Z");
    // A agenda sempre lê de volta em UTC, que é a convenção do arquivo.
    expect(formatTz(primeiro, "UTC", "yyyy-MM-dd")).toBe("2026-08-23");
  });

  it("dá onze horas de folga para cada lado antes de trocar de data", () => {
    // O meio-dia não é mágico: aguenta ±11h. Cobre de Midway ao Pacífico
    // ocidental, e portanto todo fuso em que um salão brasileiro é atendido ou
    // olhado. Além disso (Kiritimati, +14) a data vira — e por isso a agenda lê
    // sempre em UTC, nunca no fuso de quem olha.
    const [dia] = diasDoIntervaloUtc("2026-08-23", "2026-08-23");
    for (const fuso of [
      "Pacific/Midway",
      "America/Sao_Paulo",
      "UTC",
      "Europe/Lisbon",
      "Asia/Tokyo",
      "Pacific/Guadalcanal",
    ]) {
      expect(formatTz(dia, fuso, "yyyy-MM-dd")).toBe("2026-08-23");
    }
    expect(formatTz(dia, "Pacific/Kiritimati", "yyyy-MM-dd")).toBe("2026-08-24");
  });

  it("atravessa a virada do mês e do ano", () => {
    expect(diasDoIntervaloUtc("2026-08-30", "2026-09-02")).toHaveLength(4);
    expect(
      diasDoIntervaloUtc("2026-12-30", "2027-01-02").map((d) => formatTz(d, "UTC", "dd/MM")),
    ).toEqual(["30/12", "31/12", "01/01", "02/01"]);
  });

  it("não perde nem duplica dia na virada do horário de verão", () => {
    // 04/11/2018, última virada brasileira: 24h fixas não podem produzir 23h.
    const dias = diasDoIntervaloUtc("2018-11-01", "2018-11-07");
    expect(dias.map((d) => formatTz(d, "America/Sao_Paulo", "dd"))).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
    ]);
  });
});
