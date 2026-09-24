import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AsaasAuthError,
  AsaasError,
  ambienteDaChave,
  criarCliente,
  criarCobrancaCartao,
  criarCobrancaPix,
  mascararChave,
  pagamentoConfirmado,
  temChavePix,
} from "./asaas";

const CHAVE_PROD = "$aact_prod_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZm";
const CHAVE_SANDBOX = "$aact_hmlg_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZm";

function respostaDe(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status });
}

function chamada(fetchSpy: { mock: { calls: unknown[][] } }, i = 0) {
  const [url, init] = fetchSpy.mock.calls[i] as unknown as [string, RequestInit];
  return { url, headers: init.headers as Record<string, string>, corpo: JSON.parse(init.body as string) };
}

const COBRANCA = {
  clienteId: "cus_1",
  valorCents: 3995,
  descricao: "Sinal do atendimento",
  vencimento: new Date("2026-09-24T15:00:00Z"),
  referencia: "412",
};

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

describe("status do pagamento", () => {
  it("só conta como pago o que já é dinheiro da clínica", () => {
    expect(pagamentoConfirmado("CONFIRMED")).toBe(true);
    expect(pagamentoConfirmado("RECEIVED")).toBe(true);
    expect(pagamentoConfirmado("PENDING")).toBe(false);
    expect(pagamentoConfirmado("AWAITING_RISK_ANALYSIS")).toBe(false);
    expect(pagamentoConfirmado("REFUNDED")).toBe(false);
  });
});

describe("cliente no Asaas", () => {
  it("manda CPF só com dígitos", async () => {
    // O Asaas exige documento para criar cliente, e cliente para cobrar: é
    // por isso que o checkout pede CPF.
    const fetchSpy = vi.fn(async () => respostaDe({ id: "cus_9" }));
    vi.stubGlobal("fetch", fetchSpy);
    const id = await criarCliente(CHAVE_PROD, { nome: "Ana", cpf: "529.982.247-25", email: null, telefone: "(92) 99999-1234" });
    expect(id).toBe("cus_9");
    const { url, corpo } = chamada(fetchSpy);
    expect(url).toBe("https://api.asaas.com/v3/customers");
    expect(corpo.cpfCnpj).toBe("52998224725");
    expect(corpo.mobilePhone).toBe("92999991234");
    // Quem avisa a cliente somos nós, pelo WhatsApp que ela já está usando.
    expect(corpo.notificationDisabled).toBe(true);
  });
});

describe("cobrança PIX", () => {
  it("usa o ambiente da chave e os cabeçalhos que o Asaas exige", async () => {
    const fetchSpy = vi.fn(async () => respostaDe({ id: "pay_1", status: "PENDING" }));
    vi.stubGlobal("fetch", fetchSpy);

    const cobranca = await criarCobrancaPix(CHAVE_SANDBOX, COBRANCA);

    expect(cobranca).toEqual({ id: "pay_1", status: "PENDING", confirmada: false });
    const { url, headers, corpo } = chamada(fetchSpy);
    expect(url).toBe("https://api-sandbox.asaas.com/v3/payments");
    expect(headers.access_token).toBe(CHAVE_SANDBOX);
    // Sem User-Agent o Asaas recusa a chamada, e o erro não diz por quê.
    expect(headers["User-Agent"]).toBeTruthy();
    expect(corpo.billingType).toBe("PIX");
    expect(corpo.value).toBe(39.95);
    // O Asaas trabalha com DATA no vencimento; o prazo de minutos é o nosso.
    expect(corpo.dueDate).toBe("2026-09-24");
    // A referência externa é o id do agendamento: é por ela que o webhook acha
    // a reserva mesmo se chegar antes do nosso UPDATE.
    expect(corpo.externalReference).toBe("412");
  });
});

describe("cobrança no cartão", () => {
  it("manda os dados do dono e o IP que o antifraude exige", async () => {
    const fetchSpy = vi.fn(async () => respostaDe({ id: "pay_2", status: "CONFIRMED" }));
    vi.stubGlobal("fetch", fetchSpy);

    const cobranca = await criarCobrancaCartao(CHAVE_PROD, {
      ...COBRANCA,
      cartao: { numero: "4111 1111 1111 1111", nomeImpresso: "ANA SOUZA", mes: "07", ano: "2027", cvv: "123" },
      dono: {
        nome: "Ana Souza",
        email: "ana@exemplo.com",
        cpf: "529.982.247-25",
        cep: "69000-000",
        numeroDoEndereco: "120",
        telefone: "(92) 99999-1234",
      },
      ip: "203.0.113.7",
    });

    // Cartão responde na mesma chamada: recusa é frase para a cliente ler, não
    // estado pendurado na agenda.
    expect(cobranca.confirmada).toBe(true);
    const { corpo } = chamada(fetchSpy);
    expect(corpo.billingType).toBe("CREDIT_CARD");
    expect(corpo.creditCard.number).toBe("4111111111111111");
    expect(corpo.creditCard.expiryYear).toBe("2027");
    expect(corpo.creditCardHolderInfo.cpfCnpj).toBe("52998224725");
    expect(corpo.creditCardHolderInfo.postalCode).toBe("69000000");
    expect(corpo.creditCardHolderInfo.phone).toBe("92999991234");
    // Sem remoteIp o Asaas recusa sem dizer qual campo faltou.
    expect(corpo.remoteIp).toBe("203.0.113.7");
  });

  it("devolve a frase do adquirente quando o cartão é recusado", async () => {
    // É a única informação útil para quem está tentando pagar. Engolir ela
    // faria a cliente tentar o mesmo cartão de novo sem saber o que houve.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respostaDe({ errors: [{ code: "invalid_creditCard", description: "Transação não autorizada." }] }, 400),
      ),
    );
    await expect(
      criarCobrancaCartao(CHAVE_PROD, {
        ...COBRANCA,
        cartao: { numero: "4111111111111111", nomeImpresso: "ANA", mes: "07", ano: "2027", cvv: "123" },
        dono: {
          nome: "Ana",
          email: "ana@exemplo.com",
          cpf: "52998224725",
          cep: "69000000",
          numeroDoEndereco: "120",
          telefone: "92999991234",
        },
        ip: "203.0.113.7",
      }),
    ).rejects.toThrow("Transação não autorizada.");
  });
});

describe("chave recusada", () => {
  it("distingue credencial inválida de falha do Asaas", async () => {
    // Chave errada a dona resolve sozinha; instabilidade é para tentar de novo.
    vi.stubGlobal("fetch", vi.fn(async () => respostaDe({ errors: [] }, 401)));
    await expect(criarCobrancaPix(CHAVE_PROD, COBRANCA)).rejects.toBeInstanceOf(AsaasAuthError);

    vi.stubGlobal("fetch", vi.fn(async () => respostaDe({ errors: [] }, 500)));
    const falha = criarCobrancaPix(CHAVE_PROD, COBRANCA);
    await expect(falha).rejects.toBeInstanceOf(AsaasError);
    await expect(falha).rejects.not.toBeInstanceOf(AsaasAuthError);
  });
});

describe("chave PIX da conta", () => {
  it("diz que dá para cobrar por PIX quando existe chave ativa", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respostaDe({ data: [{ id: "key_1" }] })));
    expect(await temChavePix(CHAVE_PROD)).toBe(true);
  });

  it("diz que não dá quando a conta não tem chave", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respostaDe({ data: [] })));
    expect(await temChavePix(CHAVE_PROD)).toBe(false);
  });

  it("não derruba a conexão quando a rota não existe na conta", async () => {
    // Conta antiga pode não expor a rota. Conectar continua valendo; o que
    // muda é o checkout não oferecer PIX.
    vi.stubGlobal("fetch", vi.fn(async () => respostaDe({ errors: [] }, 404)));
    expect(await temChavePix(CHAVE_PROD)).toBe(false);
  });

  it("mas propaga chave recusada, que é outro problema", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respostaDe({ errors: [] }, 401)));
    await expect(temChavePix(CHAVE_PROD)).rejects.toBeInstanceOf(AsaasAuthError);
  });
});
