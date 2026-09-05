import { describe, expect, it } from "vitest";
import { montarICS } from "./ics";

const EVENTO = {
  titulo: "Alongamento em gel — ENTUR",
  inicio: new Date("2026-08-28T17:00:00.000Z"),
  duracaoMin: 90,
  local: "ENTUR Tirol — Av. Amintas Barros, 3700",
  descricao: "Com Mariana Alves.",
};

/** Desdobra as continuações antes de conferir conteúdo. */
function desdobrar(ics: string): string[] {
  return ics.replace(/\r\n /g, "").split("\r\n");
}

describe("montarICS", () => {
  it("termina toda linha em CRLF, como a especificação exige", () => {
    const ics = montarICS(EVENTO, "uid@teste");
    // Um \n solto (sem \r antes) faz o Google Calendar recusar o arquivo.
    expect(/[^\r]\n/.test(ics)).toBe(false);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR")).toBe(true);
  });

  it("grava início e fim em UTC, somando a duração", () => {
    const linhas = desdobrar(montarICS(EVENTO, "uid@teste"));
    expect(linhas).toContain("DTSTART:20260828T170000Z");
    // 17:00 + 90 min
    expect(linhas).toContain("DTEND:20260828T183000Z");
  });

  it("escapa vírgula e ponto-e-vírgula, que são separadores na especificação", () => {
    const ics = montarICS(
      { ...EVENTO, local: "Rua A, 10; sala 2", titulo: "Unha" },
      "uid@teste",
    );
    const local = desdobrar(ics).find((l) => l.startsWith("LOCATION:"));
    expect(local).toBe("LOCATION:Rua A\\, 10\\; sala 2");
  });

  it("dobra linha longa contando OCTETOS, não caracteres", () => {
    // 70 caracteres acentuados = 140 octetos: cabe em 75 caracteres e estoura
    // em 75 octetos. É o caso que uma contagem por caractere deixaria passar.
    const titulo = "á".repeat(70);
    const ics = montarICS({ ...EVENTO, titulo }, "uid@teste");
    for (const linha of ics.split("\r\n")) {
      expect(new TextEncoder().encode(linha).length).toBeLessThanOrEqual(75);
    }
    // E o conteúdo sobrevive ao desdobramento.
    expect(desdobrar(ics)).toContain(`SUMMARY:${titulo}`);
  });

  it("nunca parte um caractere multibyte ao meio", () => {
    const ics = montarICS({ ...EVENTO, titulo: "ç".repeat(80) }, "uid@teste");
    // Se um par de octetos fosse partido, o texto reconstruído teria U+FFFD.
    expect(desdobrar(ics).join("")).not.toContain("�");
  });

  it("leva um alarme de uma hora antes — é o lembrete que evita a falta", () => {
    const linhas = desdobrar(montarICS(EVENTO, "uid@teste"));
    expect(linhas).toContain("BEGIN:VALARM");
    expect(linhas).toContain("TRIGGER:-PT1H");
  });
});
