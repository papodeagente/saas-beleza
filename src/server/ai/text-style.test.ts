import { describe, expect, it } from "vitest";
import { formatForWhatsApp, stripAgentDashes, stripEmoji } from "./text-style";

/**
 * Regra de estilo do agente: nada de travessão no texto que vai para o cliente.
 * O prompt pede, o modelo esquece, esta função garante.
 */
describe("stripAgentDashes", () => {
  it("troca travessão e meia risca por vírgula", () => {
    expect(stripAgentDashes("Claro — posso agendar")).toBe("Claro, posso agendar");
    expect(stripAgentDashes("Temos 14h – 15h livres")).toBe("Temos 14h, 15h livres");
  });

  it("troca hífen espaçado usado como pontuação", () => {
    expect(stripAgentDashes("Perfeito - quinta às 10h")).toBe("Perfeito, quinta às 10h");
  });

  it("preserva o que é dado, não estilo", () => {
    expect(stripAgentDashes("Link: https://exemplo.com/a-b-c")).toContain("https://exemplo.com/a-b-c");
    expect(stripAgentDashes("Ligue 9950-6241")).toContain("9950-6241");
    expect(stripAgentDashes("Escreva para ana-maria@salao.com.br")).toContain("ana-maria@salao.com.br");
  });

  it("transforma palavra composta em duas palavras", () => {
    expect(stripAgentDashes("faça o check-in antes")).toBe("faça o check in antes");
  });

  it("não mexe em texto que já está limpo", () => {
    const texto = "Oi Marina, tenho quinta às 10h. Serve?";
    expect(stripAgentDashes(texto)).toBe(texto);
  });

  it("converte marcador de lista em bullet", () => {
    expect(stripAgentDashes("- corte\n- escova")).toBe("• corte\n• escova");
  });
});

describe("formatForWhatsApp", () => {
  it("remove formatação de documento e ajusta negrito", () => {
    expect(formatForWhatsApp("## Serviços\n\n**Corte** custa R$ 80")).toBe("Serviços\n\n*Corte* custa R$ 80");
  });
});

describe("stripEmoji", () => {
  it("tira emoji simples e não deixa espaço sobrando", () => {
    expect(stripEmoji("Oi! 😊 Tudo bem?")).toBe("Oi! Tudo bem?");
    expect(stripEmoji("Perfeito 👍")).toBe("Perfeito");
  });

  it("tira a sequência inteira, não só o primeiro símbolo", () => {
    // Família unida por ZWJ: apagar só o primeiro membro deixaria os outros
    // três na tela.
    expect(stripEmoji("familia 👨‍👩‍👧‍👦 aqui")).toBe("familia aqui");
    // Tom de pele é modificador, não emoji separado.
    expect(stripEmoji("oi 👋🏽")).toBe("oi");
    // Bandeira são dois indicadores regionais.
    expect(stripEmoji("Brasil 🇧🇷 sim")).toBe("Brasil sim");
  });

  it("não mexe em texto sem emoji", () => {
    const texto = "Limpeza de Pele Profunda, R$ 180, 1h10.";
    expect(stripEmoji(texto)).toBe(texto);
  });

  it("encosta a pontuação na palavra em vez de deixar o espaço do emoji", () => {
    expect(stripEmoji("Combinado 😊 !")).toBe("Combinado!");
  });

  it("não come pontuação nem número", () => {
    expect(stripEmoji("São R$ 80,00 😊, quer ver os horários?")).toBe(
      "São R$ 80,00, quer ver os horários?",
    );
  });

  it("preserva a quebra de linha entre as opções", () => {
    expect(stripEmoji("Tenho:\n• 10h 😊\n• 14h30")).toBe("Tenho:\n• 10h\n• 14h30");
  });
});

describe("formatForWhatsApp com semEmoji", () => {
  it("só tira emoji quando pedido", () => {
    expect(formatForWhatsApp("Oi 😊")).toBe("Oi 😊");
    expect(formatForWhatsApp("Oi 😊", { semEmoji: true })).toBe("Oi");
  });

  it("continua tirando travessão nos dois casos", () => {
    expect(formatForWhatsApp("Oi — tudo bem 😊", { semEmoji: true })).toBe("Oi, tudo bem");
  });
});
