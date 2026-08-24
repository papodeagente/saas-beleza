import { describe, expect, it } from "vitest";
import { initials } from "./avatar";

/**
 * Guarda contra a volta do "(9".
 *
 * Contato criado pelo WhatsApp guarda o telefone na coluna `name` até alguém
 * identificá-lo, e a versão anterior desta função fatiava os dois primeiros
 * caracteres do que estivesse lá. O resultado era um círculo com "(9", "55" ou
 * "84" na lista de conversas, na agenda e na ficha — dado bruto disfarçado de
 * inicial. Nada no build, no tipo ou no lint pega isso; só teste pega.
 */
describe("iniciais do avatar", () => {
  it("tira iniciais de nome de gente", () => {
    expect(initials("Mariana Albuquerque")).toBe("MA");
    expect(initials("Bruno Barbosa da Silva")).toBe("BS");
    expect(initials("Ana")).toBe("AN");
    expect(initials("  vanessa   torres  ")).toBe("VT");
  });

  it("preserva acento e apóstrofo", () => {
    expect(initials("Ângela Ítalo")).toBe("ÂÍ");
    expect(initials("D'Ávila")).toBe("DÁ");
  });

  it("devolve null quando não sobra letra nenhuma", () => {
    // O avatar troca por ícone de pessoa nesses casos.
    expect(initials("(84) 99999-0000")).toBeNull();
    expect(initials("5584999990000")).toBeNull();
    expect(initials("+55 84 9 9999-0000")).toBeNull();
    expect(initials("   ")).toBeNull();
    expect(initials("")).toBeNull();
  });

  it("ignora o pedaço numérico e fica só com a palavra", () => {
    expect(initials("Renata 5584999990000")).toBe("RE");
    expect(initials("(84) 99999-0000 Renata Fonseca")).toBe("RF");
  });
});
