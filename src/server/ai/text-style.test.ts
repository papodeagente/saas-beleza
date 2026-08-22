import { describe, expect, it } from "vitest";
import { formatForWhatsApp, stripAgentDashes } from "./text-style";

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
