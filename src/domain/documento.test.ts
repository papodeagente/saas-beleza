import { describe, expect, it } from "vitest";
import {
  bandeiraDoCartao,
  cpfValido,
  formatarCep,
  formatarCpf,
  formatarNumeroDoCartao,
  formatarValidade,
  lerValidade,
  numeroDeCartaoPlausivel,
} from "./documento";

describe("CPF", () => {
  it("aceita CPF com dígitos verificadores certos", () => {
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cpfValido("52998224725")).toBe(true);
  });

  it("recusa dígito verificador errado", () => {
    // O Asaas recusaria isto com uma frase genérica, DEPOIS do cartão digitado.
    expect(cpfValido("529.982.247-26")).toBe(false);
  });

  it("recusa sequência repetida", () => {
    // Passa na conta dos dígitos e não é CPF de ninguém.
    expect(cpfValido("111.111.111-11")).toBe(false);
    expect(cpfValido("000.000.000-00")).toBe(false);
  });

  it("recusa tamanho errado", () => {
    expect(cpfValido("5299822472")).toBe(false);
    expect(cpfValido("")).toBe(false);
  });

  it("formata enquanto a pessoa digita", () => {
    expect(formatarCpf("529")).toBe("529");
    expect(formatarCpf("5299")).toBe("529.9");
    expect(formatarCpf("5299822")).toBe("529.982.2");
    expect(formatarCpf("52998224725")).toBe("529.982.247-25");
    // Dígito a mais é descartado, não empurra a máscara.
    expect(formatarCpf("529982247259")).toBe("529.982.247-25");
  });
});

describe("CEP", () => {
  it("formata em cinco mais três", () => {
    expect(formatarCep("69000")).toBe("69000");
    expect(formatarCep("69000000")).toBe("69000-000");
    expect(formatarCep("69.000-000")).toBe("69000-000");
  });
});

describe("cartão", () => {
  it("formata em grupos de quatro, até 19 dígitos", () => {
    expect(formatarNumeroDoCartao("4111111111111111")).toBe("4111 1111 1111 1111");
    expect(formatarNumeroDoCartao("41111")).toBe("4111 1");
    // Elo e Hipercard chegam a 19: cortar em 16 recusaria cartão válido.
    expect(formatarNumeroDoCartao("6062825624223003301")).toBe("6062 8256 2422 3003 301");
  });

  it("reconhece número impossível antes de gastar tentativa no gateway", () => {
    expect(numeroDeCartaoPlausivel("4111 1111 1111 1111")).toBe(true);
    expect(numeroDeCartaoPlausivel("4111 1111 1111 1112")).toBe(false);
    expect(numeroDeCartaoPlausivel("411")).toBe(false);
  });

  it("formata a validade", () => {
    expect(formatarValidade("0")).toBe("0");
    expect(formatarValidade("07")).toBe("07");
    expect(formatarValidade("0727")).toBe("07/27");
  });

  it("devolve o ano com quatro dígitos, como o Asaas quer", () => {
    const agora = new Date("2026-09-24T12:00:00Z");
    expect(lerValidade("07/27", agora)).toEqual({ mes: "07", ano: "2027" });
  });

  it("aceita o cartão até o fim do mês impresso nele", () => {
    // Setembro de 2026 vale durante todo setembro de 2026.
    expect(lerValidade("09/26", new Date("2026-09-24T12:00:00Z"))).toEqual({ mes: "09", ano: "2026" });
    expect(lerValidade("09/26", new Date("2026-10-01T00:00:01Z"))).toBeNull();
  });

  it("recusa mês impossível e tamanho errado", () => {
    const agora = new Date("2026-09-24T12:00:00Z");
    expect(lerValidade("13/27", agora)).toBeNull();
    expect(lerValidade("00/27", agora)).toBeNull();
    expect(lerValidade("7/27", agora)).toBeNull();
  });
});

describe("bandeira do cartão", () => {
  it("reconhece as bandeiras comuns", () => {
    expect(bandeiraDoCartao("4111 1111 1111 1111")).toBe("Visa");
    expect(bandeiraDoCartao("5555 6666 7777 8884")).toBe("Mastercard");
    expect(bandeiraDoCartao("3782 822463 10005")).toBe("American Express");
    expect(bandeiraDoCartao("3056 9309 0259 04")).toBe("Diners Club");
  });

  it("reconhece Mastercard da faixa nova", () => {
    expect(bandeiraDoCartao("2221 0000 0000 0009")).toBe("Mastercard");
    expect(bandeiraDoCartao("2720 9999 9999 9999")).toBe("Mastercard");
    // 2721 já saiu da faixa.
    expect(bandeiraDoCartao("2721 0000 0000 0000")).toBeNull();
  });

  it("não confunde Elo com Visa nem com Mastercard", () => {
    // A Elo mora DENTRO das faixas da Visa (4...) e do Mastercard (5...).
    // Testar o "4" primeiro erraria a bandeira do cartão mais comum num salão.
    expect(bandeiraDoCartao("4011 7800 0000 0000")).toBe("Elo");
    expect(bandeiraDoCartao("5041 7500 0000 0000")).toBe("Elo");
    expect(bandeiraDoCartao("5066 9900 0000 0000")).toBe("Elo");
    expect(bandeiraDoCartao("6505 0000 0000 0000")).toBe("Elo");
  });

  it("não confunde Hipercard com Diners", () => {
    expect(bandeiraDoCartao("6062 8200 0000 0000")).toBe("Hipercard");
    expect(bandeiraDoCartao("3841 0000 0000 0000")).toBe("Hipercard");
  });

  it("espera dígitos suficientes antes de chutar", () => {
    expect(bandeiraDoCartao("41")).toBeNull();
    expect(bandeiraDoCartao("")).toBeNull();
    expect(bandeiraDoCartao("9999 9999 9999 9999")).toBeNull();
  });
});
