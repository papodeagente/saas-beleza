import { describe, expect, it } from "vitest";
import {
  diasConsultaveis,
  diasNoMes,
  gradeDoMes,
  limitesDeNavegacao,
  mesAAbrir,
  mesDe,
  somarDias,
  somarMeses,
} from "./calendario";

describe("grade do mês", () => {
  it("começa no domingo e põe o dia 1º na coluna certa", () => {
    // 1º de agosto de 2026 é um sábado: seis células vazias antes.
    const grade = gradeDoMes("2026-08");
    expect(grade).toHaveLength(42);
    expect(grade.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(grade[6]).toBe("2026-08-01");
  });

  it("mantém seis linhas mesmo quando cinco bastariam", () => {
    // Fevereiro de 2027 começa numa segunda e tem 28 dias: cabe em cinco
    // semanas, e ainda assim a grade tem 42 células.
    const grade = gradeDoMes("2027-02");
    expect(grade).toHaveLength(42);
    expect(grade.filter(Boolean)).toHaveLength(28);
    expect(grade[grade.length - 1]).toBeNull();
  });

  it("não perde nem repete nenhum dia do mês", () => {
    for (const mes of ["2026-02", "2026-08", "2027-02", "2028-02", "2026-12"]) {
      const dias = gradeDoMes(mes).filter(Boolean);
      expect(dias).toHaveLength(diasNoMes(mes));
      expect(new Set(dias).size).toBe(dias.length);
      expect(dias[0]).toBe(`${mes}-01`);
    }
  });

  it("conhece o ano bissexto", () => {
    expect(diasNoMes("2028-02")).toBe(29);
    expect(diasNoMes("2027-02")).toBe(28);
  });
});

describe("aritmética sem fuso", () => {
  it("soma dias atravessando a virada do mês e do ano", () => {
    expect(somarDias("2026-08-31", 1)).toBe("2026-09-01");
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(somarDias("2026-08-26", 120)).toBe("2026-12-24");
  });

  it("soma meses a partir do dia 31 sem pular fevereiro", () => {
    // A armadilha: `setMonth` sobre 31 de janeiro cai em 3 de março.
    expect(somarMeses("2026-01", 1)).toBe("2026-02");
    expect(somarMeses("2026-12", 1)).toBe("2027-01");
    expect(somarMeses("2026-01", -1)).toBe("2025-12");
  });

  it("atravessa a virada do horário de verão brasileiro sem repetir o dia", () => {
    // 2018-11-04 foi a última virada de horário de verão no Brasil; o teste
    // vale como regressão para qualquer fuso que a máquina de CI use.
    expect(somarDias("2018-11-03", 1)).toBe("2018-11-04");
    expect(somarDias("2018-02-17", 1)).toBe("2018-02-18");
  });

  it("extrai o mês", () => {
    expect(mesDe("2026-08-28")).toBe("2026-08");
  });
});

describe("o que é perguntado ao servidor", () => {
  const { ultimoISO } = limitesDeNavegacao("2026-08-26", 120);

  it("cabe no teto de 31 dias da ação pública", () => {
    for (const mes of ["2026-08", "2026-09", "2026-10", "2026-12"]) {
      expect(
        diasConsultaveis(mes, "2026-08-26", ultimoISO).length,
      ).toBeLessThanOrEqual(31);
    }
  });

  it("não pergunta por dia que já passou", () => {
    const dias = diasConsultaveis("2026-08", "2026-08-26", ultimoISO);
    expect(dias[0]).toBe("2026-08-26");
    expect(dias).toHaveLength(6);
  });

  it("para no horizonte do serviço, no meio do mês", () => {
    const curto = limitesDeNavegacao("2026-08-26", 45);
    expect(curto.ultimoISO).toBe("2026-10-10");
    const dias = diasConsultaveis("2026-10", "2026-08-26", curto.ultimoISO);
    expect(dias.at(-1)).toBe("2026-10-10");
    expect(dias).toHaveLength(10);
  });

  it("devolve nada para mês inteiramente fora do horizonte", () => {
    const curto = limitesDeNavegacao("2026-08-26", 45);
    expect(diasConsultaveis("2026-11", "2026-08-26", curto.ultimoISO)).toEqual(
      [],
    );
  });
});

describe("limites de navegação", () => {
  it("vai do mês de hoje ao mês do último dia agendável", () => {
    expect(limitesDeNavegacao("2026-08-26", 45)).toEqual({
      primeiroMes: "2026-08",
      ultimoMes: "2026-10",
      ultimoISO: "2026-10-10",
    });
    expect(limitesDeNavegacao("2026-08-26", 120).ultimoMes).toBe("2026-12");
  });
});

describe("mês que abre depois da resposta do servidor", () => {
  it("avança quando o mês veio vazio e há para onde ir", () => {
    expect(mesAAbrir("2026-08", 0, true, "2026-10")).toBe("2026-09");
  });

  it("fica onde está quando o mês tem dia livre", () => {
    expect(mesAAbrir("2026-08", 1, true, "2026-10")).toBe("2026-08");
  });

  it("não avança na navegação da cliente, só no carregamento", () => {
    // Ela clicou na seta para ver setembro; setembro está vazio. Pular para
    // outubro seria a página tirando da tela o mês que ela pediu.
    expect(mesAAbrir("2026-09", 0, false, "2026-10")).toBe("2026-09");
  });

  it("não passa do último mês agendável", () => {
    expect(mesAAbrir("2026-10", 0, true, "2026-10")).toBe("2026-10");
  });

  it("avança uma vez só, mesmo em virada de ano", () => {
    expect(mesAAbrir("2026-12", 0, true, "2027-02")).toBe("2027-01");
  });
});
