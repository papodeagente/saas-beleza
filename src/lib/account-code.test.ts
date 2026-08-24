import { describe, expect, it } from "vitest";
import {
  formatAccountCode,
  generateAccountCode,
  isAccountCode,
  normalizeAccountCode,
} from "./account-code";

/**
 * O código da conta existe para ser ditado por telefone. Os testes cobrem
 * justamente o caminho humano: o que a pessoa fala, o que ela digita errado, e
 * o que o suporte cola na busca.
 */
describe("código da conta", () => {
  it("gera no formato de dois grupos de quatro", () => {
    const codigo = generateAccountCode();
    expect(codigo).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it("nunca usa as letras que se confundem ao ler em voz alta", () => {
    for (let i = 0; i < 1000; i++) {
      expect(generateAccountCode()).not.toMatch(/[ILOU]/);
    }
  });

  it("não repete: mil códigos seguidos são mil códigos distintos", () => {
    // Colisão aqui denunciaria fonte de aleatoriedade fraca ou viés no alfabeto.
    const vistos = new Set<string>();
    for (let i = 0; i < 1000; i++) vistos.add(generateAccountCode());
    expect(vistos.size).toBe(1000);
  });

  it("distribui os caracteres sem favorecer nenhum", () => {
    // 256 é múltiplo de 32, então byte % 32 é uniforme; um viés apareceria como
    // um símbolo muito acima ou abaixo da média em uma amostra grande.
    const contagem = new Map<string, number>();
    const amostras = 4000;
    for (let i = 0; i < amostras; i++) {
      for (const caractere of generateAccountCode().replace("-", "")) {
        contagem.set(caractere, (contagem.get(caractere) ?? 0) + 1);
      }
    }
    const media = (amostras * 8) / 32;
    for (const [, quantas] of contagem) {
      expect(quantas).toBeGreaterThan(media * 0.6);
      expect(quantas).toBeLessThan(media * 1.4);
    }
  });

  it("aceita o código como a pessoa digita", () => {
    const canonico = "A3K9-7QF2";
    expect(normalizeAccountCode("A3K97QF2")).toBe(canonico);
    expect(normalizeAccountCode("a3k9-7qf2")).toBe(canonico);
    expect(normalizeAccountCode(" A3K9 7QF2 ")).toBe(canonico);
  });

  it("corrige as trocas que o alfabeto tenta evitar", () => {
    // Quem lê de um papel escreve O no lugar de 0 e I no lugar de 1.
    expect(normalizeAccountCode("A3KO-7QFI")).toBe("A3K0-7QF1");
    expect(normalizeAccountCode("LLLL-0000")).toBe("1111-0000");
  });

  it("recusa o que não é código, em vez de devolver algo parecido", () => {
    expect(normalizeAccountCode("A3K9")).toBeNull();
    expect(normalizeAccountCode("A3K9-7QF2-XX")).toBeNull();
    expect(normalizeAccountCode("clinica-lumina")).toBeNull();
    expect(normalizeAccountCode("")).toBeNull();
  });

  it("reconhece um código válido para a busca decidir o que fazer", () => {
    expect(isAccountCode("A3K9-7QF2")).toBe(true);
    expect(isAccountCode("a3k97qf2")).toBe(true);
    // Nome de clínica não pode ser confundido com código.
    expect(isAccountCode("Lumina")).toBe(false);
  });

  it("formata um código bruto sem depender de como ele veio", () => {
    expect(formatAccountCode("a3k97qf2")).toBe("A3K9-7QF2");
    expect(formatAccountCode("A3K9-7QF2")).toBe("A3K9-7QF2");
  });
});
