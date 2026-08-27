import { describe, expect, it } from "vitest";
import { duracao, passosDaClinica } from "./booking-flow";

/**
 * O contador de passo e a duração são as duas frases que a página escreve sobre
 * si mesma. As duas já mentiram.
 */

describe("quantos passos esta clínica tem", () => {
  it("não cobra o passo de escolha quando não há escolha", () => {
    // Foi na conta com UM serviço publicado que o dono chamou a página de feia:
    // "O que você quer fazer?" com uma opção só é pergunta que já tem resposta.
    expect(passosDaClinica(1)).toEqual(["Dia e hora", "Seus dados"]);
  });

  it("são três com catálogo, e três é o teto", () => {
    // A unidade saiu da conta: ela deixou de ser tela e virou uma pílula ao
    // lado do calendário, porque "em qual loja?" é detalhe do "quando".
    expect(passosDaClinica(6)).toEqual(["Serviço", "Dia e hora", "Seus dados"]);
    expect(passosDaClinica(40)).toHaveLength(3);
  });

  it("nunca fica sem passo, mesmo com catálogo vazio", () => {
    // Clínica sem serviço publicado ainda vê a tela de vazio, e a linha de
    // passo não pode sair como "1 de 0".
    expect(passosDaClinica(0).length).toBeGreaterThanOrEqual(2);
  });
});

describe("duração para gente", () => {
  it("mantém minutos abaixo de uma hora", () => {
    expect(duracao(45)).toBe("45 min");
    expect(duracao(15)).toBe("15 min");
  });

  it("vira hora cheia sem zeros à toa", () => {
    // Ninguém marca a tarde pensando em cento e cinquenta minutos.
    expect(duracao(60)).toBe("1h");
    expect(duracao(120)).toBe("2h");
  });

  it("mantém os minutos quebrados com dois dígitos", () => {
    expect(duracao(90)).toBe("1h30");
    expect(duracao(65)).toBe("1h05");
    expect(duracao(150)).toBe("2h30");
  });
});
