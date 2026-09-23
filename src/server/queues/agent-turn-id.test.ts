import { describe, expect, it } from "vitest";
import { idDoTurno } from "./agent-turn-id";

/**
 * Este teste existe por causa de uma semana inteira de silêncio.
 *
 * O agente estava ligado em duas contas, 2.043 mensagens entraram e nenhuma
 * resposta saiu: o id do job levava ":" e o BullMQ recusa. Os testes da fila
 * mockam o Redis, e o dublê aceitava o id inválido — verde de ponta a ponta,
 * produção muda.
 */
describe("id do job de turno", () => {
  it("nunca leva dois-pontos, que é o que o BullMQ recusa", () => {
    expect(idDoTurno(42)).not.toContain(":");
    expect(idDoTurno(42, 1758600000000)).not.toContain(":");
  });

  it("é estável por conversa, para a rajada coalescer num turno só", () => {
    expect(idDoTurno(42)).toBe(idDoTurno(42));
    expect(idDoTurno(42)).not.toBe(idDoTurno(43));
  });

  it("com carimbo vira id único, para o turno que já está rodando não ser atropelado", () => {
    expect(idDoTurno(42, 1)).not.toBe(idDoTurno(42, 2));
    expect(idDoTurno(42, 1)).not.toBe(idDoTurno(42));
  });
});
