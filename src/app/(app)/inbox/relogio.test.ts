import { describe, expect, it } from "vitest";
import { horaDaLista, rotuloDoSeparador } from "./relogio";

const NATAL = "America/Sao_Paulo";
const MANAUS = "America/Manaus";

/**
 * 26/08/2026 01:30 UTC é 25/08 22:30 em Natal. É a mensagem que a atendente
 * recebe fechando a caixa, e era exatamente onde a tela mentia: o servidor
 * (UTC) escrevia "01:30" e a data do dia seguinte.
 */
const NOITE_DE_TERCA = "2026-08-26T01:30:00.000Z";
const AGORA = new Date("2026-08-26T02:00:00.000Z"); // 25/08 23:00 em Natal

describe("hora da lista", () => {
  it("mostra a hora do salão para o que ainda é hoje lá", () => {
    expect(horaDaLista(NOITE_DE_TERCA, NATAL, AGORA)).toBe("22:30");
  });

  it("não usa o relógio de quem renderizou", () => {
    // A prova de que o defeito era este: em UTC a mesma mensagem é de outro dia.
    expect(new Date(NOITE_DE_TERCA).toISOString()).toContain("2026-08-26");
    expect(horaDaLista(NOITE_DE_TERCA, NATAL, AGORA)).not.toBe("01:30");
  });

  it("diz Ontem quando o salão já virou o dia", () => {
    const quartaDeManha = new Date("2026-08-26T13:00:00.000Z"); // 10:00 em Natal
    expect(horaDaLista(NOITE_DE_TERCA, NATAL, quartaDeManha)).toBe("Ontem");
  });

  it("usa o dia da semana dentro da semana e a data depois", () => {
    const seisDiasDepois = new Date("2026-08-31T13:00:00.000Z");
    expect(horaDaLista(NOITE_DE_TERCA, NATAL, seisDiasDepois)).toBe("ter");
    const oitoDiasDepois = new Date("2026-09-02T13:00:00.000Z");
    expect(horaDaLista(NOITE_DE_TERCA, NATAL, oitoDiasDepois)).toBe("25/08");
  });

  it("não joga para 'dd/MM' a mensagem carimbada à frente do nosso relógio", () => {
    // O provedor carimba a mensagem; o relógio da máquina pode estar atrás.
    const agoraAtrasado = new Date("2026-08-26T01:29:00.000Z");
    expect(horaDaLista(NOITE_DE_TERCA, NATAL, agoraAtrasado)).toBe("22:30");
  });

  it("respeita o fuso de cada salão", () => {
    expect(horaDaLista(NOITE_DE_TERCA, MANAUS, AGORA)).toBe("21:30");
  });
});

describe("separador de data", () => {
  it("diz Hoje pelo calendário do salão", () => {
    expect(rotuloDoSeparador(NOITE_DE_TERCA, NATAL, AGORA)).toBe("Hoje");
  });

  it("diz Ontem depois da virada do salão", () => {
    expect(rotuloDoSeparador(NOITE_DE_TERCA, NATAL, new Date("2026-08-26T13:00:00.000Z"))).toBe(
      "Ontem",
    );
  });

  it("escreve a data do salão, não a de quem renderizou", () => {
    const semanaDepois = new Date("2026-09-02T13:00:00.000Z");
    expect(rotuloDoSeparador(NOITE_DE_TERCA, NATAL, semanaDepois)).toBe("25 de agosto");
  });
});
