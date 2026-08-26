import { describe, expect, it } from "vitest";
import { parseBRL } from "@/lib/money";

/**
 * O campo de dinheiro do catálogo.
 *
 * A versão anterior fazia `Number(valor.replace(",", "."))` e o ponto de milhar
 * sobrevivia: "2.800" virava 2,80. No cadastro isso nasce errado; na edição
 * apaga um preço certo — e o preço vai direto para a página pública que VENDE
 * por ele. Estes casos são os que a dona digita de verdade.
 */
describe("preço digitado por gente", () => {
  it("entende o ponto como separador de milhar", () => {
    expect(parseBRL("2.800")).toBe(280_000);
    expect(parseBRL("2.800,00")).toBe(280_000);
    expect(parseBRL("1.500,50")).toBe(150_050);
  });

  it("entende o formato sem milhar", () => {
    expect(parseBRL("2500,00")).toBe(250_000);
    expect(parseBRL("35")).toBe(3_500);
    expect(parseBRL("39,90")).toBe(3_990);
  });

  it("trata zero como preço, e vazio como ausência", () => {
    // Serviço de cortesia existe. Campo vazio é outra coisa.
    expect(parseBRL("0")).toBe(0);
    expect(parseBRL("0,00")).toBe(0);
    expect(parseBRL("")).toBeNull();
  });

  it("recusa o que não é número em vez de devolver NaN", () => {
    // NaN chegava ao zod e voltava como "expected number, received NaN",
    // em inglês, na gaveta.
    expect(parseBRL("abc")).toBeNull();
    expect(parseBRL("-10")).toBeNull();
  });
});
