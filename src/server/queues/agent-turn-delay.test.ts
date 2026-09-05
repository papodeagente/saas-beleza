import { describe, expect, it } from "vitest";
import { dividirAtraso } from "./agent-turn-processor";

/**
 * O atraso de resposta do agente é a última coisa que separa o cliente de uma
 * mensagem que já não deveria sair.
 *
 * Entregando o atraso inteiro ao campo `delay` do /send/text, o cliente ganhava
 * "Digitando..." mas a conversa saía das nossas mãos assim que a chamada era
 * feita: um clique em "pausar IA" nos dois minutos seguintes não alcançava mais
 * a mensagem, e a releitura da pausa logo antes do envio virava enfeite. A
 * divisão devolve a espera longa para o nosso lado, onde ela continua
 * cancelável, e deixa para o provedor só o pedaço que o cliente precisa ver.
 */
describe("divisão do atraso do agente", () => {
  it("mantém a espera longa do nosso lado, onde a pausa ainda alcança", () => {
    // 120 s é o teto que a tela do agente aceita.
    expect(dividirAtraso(120_000)).toEqual({ nosso: 112_000, provedor: 8_000 });
    expect(dividirAtraso(30_000)).toEqual({ nosso: 22_000, provedor: 8_000 });
  });

  it("não fatia o que já é curto: o atraso inteiro vira 'Digitando...'", () => {
    expect(dividirAtraso(5_000)).toEqual({ nosso: 0, provedor: 5_000 });
    expect(dividirAtraso(8_000)).toEqual({ nosso: 0, provedor: 8_000 });
  });

  it("sem atraso configurado não segura nada, nem aqui nem no provedor", () => {
    expect(dividirAtraso(0)).toEqual({ nosso: 0, provedor: 0 });
    // Um valor corrompido não pode prender a mensagem para sempre.
    expect(dividirAtraso(Number.NaN)).toEqual({ nosso: 0, provedor: 0 });
    expect(dividirAtraso(-5_000)).toEqual({ nosso: 0, provedor: 0 });
  });
});
