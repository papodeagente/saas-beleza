import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AsaasAuthError,
  AsaasError,
  ambienteDaChave,
  criarLinkDePagamento,
  mascararChave,
} from "./asaas";

const CHAVE_PROD = "$aact_prod_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZm";
const CHAVE_SANDBOX = "$aact_hmlg_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZm";

function respostaDe(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ambiente pelo prefixo da chave", () => {
  it("só trata como produção a chave de produção", () => {
    // Ler o prefixo, em vez de pedir o ambiente numa lista na tela, elimina a
    // classe de erro em que a clínica cola chave de teste achando que é real e
    // descobre quando o dinheiro não chega.
    expect(ambienteDaChave(CHAVE_PROD)).toBe("producao");
    expect(ambienteDaChave(CHAVE_SANDBOX)).toBe("sandbox");
    expect(ambienteDaChave("  $aact_prod_abc  ")).toBe("producao");
  });
});

describe("máscara da chave", () => {
  it("mostra só o fim", () => {
    expect(mascararChave(CHAVE_PROD)).toBe(`••••${CHAVE_PROD.slice(-6)}`);
    expect(mascararChave(CHAVE_PROD)).not.toContain("aact");
  });

  it("não vaza chave curta", () => {
    expect(mascararChave("$aact_x")).toBe("••••");
  });
});

describe("link de pagamento", () => {
  it("recusa valor abaixo do mínimo do Asaas antes de chamar a API", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      criarLinkDePagamento(CHAVE_PROD, {
        nome: "Sinal",
        descricao: "Sinal",
        valorCents: 499,
        expiraEm: new Date("2026-09-24T12:00:00Z"),
      }),
    ).rejects.toBeInstanceOf(AsaasError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("chama o ambiente da chave com os cabeçalhos que o Asaas exige", async () => {
    const fetchSpy = vi.fn(async () => respostaDe({ id: "pl_1", url: "https://asaas.com/c/pl_1" }));
    vi.stubGlobal("fetch", fetchSpy);

    const link = await criarLinkDePagamento(CHAVE_SANDBOX, {
      nome: "Sinal",
      descricao: "Sinal do atendimento",
      valorCents: 3995,
      expiraEm: new Date("2026-09-24T23:30:00Z"),
    });

    expect(link).toEqual({ id: "pl_1", url: "https://asaas.com/c/pl_1" });
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api-sandbox.asaas.com/v3/paymentLinks");
    const headers = init.headers as Record<string, string>;
    expect(headers.access_token).toBe(CHAVE_SANDBOX);
    // Sem User-Agent o Asaas recusa a chamada, e o erro dele não diz por quê.
    expect(headers["User-Agent"]).toBeTruthy();

    const corpo = JSON.parse(init.body as string);
    expect(corpo.value).toBe(39.95);
    expect(corpo.chargeType).toBe("DETACHED");
    // UNDEFINED deixa a cliente escolher PIX, cartão ou boleto na tela do Asaas.
    expect(corpo.billingType).toBe("UNDEFINED");
    // O Asaas trabalha com DATA no fim do link, não com instante.
    expect(corpo.endDate).toBe("2026-09-24");
    // Quem avisa a cliente é o WhatsApp, não e-mail de cobrança.
    expect(corpo.notificationEnabled).toBe(false);
  });

  it("usa a base de produção com chave de produção", async () => {
    const fetchSpy = vi.fn(async () => respostaDe({ id: "pl_2", url: "https://asaas.com/c/pl_2" }));
    vi.stubGlobal("fetch", fetchSpy);
    await criarLinkDePagamento(CHAVE_PROD, {
      nome: "Sinal",
      descricao: "Sinal",
      valorCents: 5000,
      expiraEm: new Date("2026-09-24T12:00:00Z"),
    });
    expect((fetchSpy.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://api.asaas.com/v3/paymentLinks",
    );
  });

  it("distingue chave recusada de falha do Asaas", async () => {
    // A tela precisa saber a diferença: chave errada a dona resolve sozinha,
    // instabilidade do Asaas é para tentar de novo.
    vi.stubGlobal("fetch", vi.fn(async () => respostaDe({ errors: [] }, 401)));
    await expect(
      criarLinkDePagamento(CHAVE_PROD, {
        nome: "Sinal",
        descricao: "Sinal",
        valorCents: 5000,
        expiraEm: new Date("2026-09-24T12:00:00Z"),
      }),
    ).rejects.toBeInstanceOf(AsaasAuthError);

    vi.stubGlobal("fetch", vi.fn(async () => respostaDe({ errors: [] }, 500)));
    const falha = criarLinkDePagamento(CHAVE_PROD, {
      nome: "Sinal",
      descricao: "Sinal",
      valorCents: 5000,
      expiraEm: new Date("2026-09-24T12:00:00Z"),
    });
    await expect(falha).rejects.toBeInstanceOf(AsaasError);
    await expect(falha).rejects.not.toBeInstanceOf(AsaasAuthError);
  });

  it("não devolve link pela metade", async () => {
    // Link sem url gravado na reserva viraria cobrança que ninguém consegue pagar.
    vi.stubGlobal("fetch", vi.fn(async () => respostaDe({ id: "pl_3" })));
    await expect(
      criarLinkDePagamento(CHAVE_PROD, {
        nome: "Sinal",
        descricao: "Sinal",
        valorCents: 5000,
        expiraEm: new Date("2026-09-24T12:00:00Z"),
      }),
    ).rejects.toBeInstanceOf(AsaasError);
  });
});
