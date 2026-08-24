import { afterEach, describe, expect, it, vi } from "vitest";
import { recipientId, requestMessageHistory, sendPresence, sendText } from "./uazapi-client";

describe("destinatário uazapi", () => {
  it("remove apenas o sufixo do contato telefônico tradicional", () => {
    expect(recipientId("5511999999999@s.whatsapp.net")).toBe("5511999999999");
  });

  it("preserva os JIDs que a API exige completos", () => {
    expect(recipientId("120363000000000000@g.us")).toBe("120363000000000000@g.us");
    expect(recipientId("192837465738291@lid")).toBe("192837465738291@lid");
    expect(recipientId("canal@newsletter")).toBe("canal@newsletter");
  });
});

/**
 * O corpo enviado é o contrato com a uazapi. Estes testes existem porque três
 * defeitos aqui eram invisíveis do lado de fora: atraso feito por nós (cliente
 * via a tela muda), presença de três segundos (o "gravando áudio" sumia antes
 * do áudio ficar pronto) e JID podado no history-sync (pedido morria sem erro).
 */
const CREDS = { baseUrl: "https://instancia.test", token: "t" };

function capturarChamadas(resposta: unknown = { messageid: "M1", status: "Sent" }) {
  const chamadas: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body?: string }) => {
      chamadas.push({ url, body: JSON.parse(init.body ?? "{}") });
      return new Response(JSON.stringify(resposta), { status: 200 });
    }),
  );
  return chamadas;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("atraso nativo do envio", () => {
  it("manda o atraso para a uazapi, que é quem mostra 'Digitando...'", async () => {
    const chamadas = capturarChamadas();
    await sendText(CREDS, "5511999999999@s.whatsapp.net", "oi", { delayMs: 8000 });
    expect(chamadas[0].url).toBe("https://instancia.test/send/text");
    expect(chamadas[0].body.delay).toBe(8000);
  });

  it("não manda campo de atraso quando não há atraso configurado", async () => {
    const chamadas = capturarChamadas();
    await sendText(CREDS, "5511999999999@s.whatsapp.net", "oi");
    expect(chamadas[0].body).not.toHaveProperty("delay");
  });

  it("limita o atraso ao teto de cinco minutos da uazapi", async () => {
    const chamadas = capturarChamadas();
    await sendText(CREDS, "5511999999999@s.whatsapp.net", "oi", { delayMs: 900_000 });
    expect(chamadas[0].body.delay).toBe(300_000);
  });
});

describe("presença", () => {
  it("mantém 'gravando áudio' de pé por tempo de áudio, não por três segundos", async () => {
    const chamadas = capturarChamadas({});
    await sendPresence(CREDS, "5511999999999@s.whatsapp.net", "recording");
    expect(chamadas[0].body).toMatchObject({ presence: "recording", delay: 45_000 });
  });

  it("usa janela curta para 'digitando', que a tela reavisa a cada três segundos", async () => {
    const chamadas = capturarChamadas({});
    await sendPresence(CREDS, "5511999999999@s.whatsapp.net", "composing");
    expect(chamadas[0].body).toMatchObject({ presence: "composing", delay: 10_000 });
  });
});

describe("pedido de histórico antigo", () => {
  it("envia o JID completo, como a rota exige", async () => {
    const chamadas = capturarChamadas({});
    await requestMessageHistory(CREDS, "5511999999999@s.whatsapp.net", 100);
    expect(chamadas[0].url).toBe("https://instancia.test/message/history-sync");
    // Podar o sufixo fazia o pedido não encontrar o chat e falhar em silêncio.
    expect(chamadas[0].body).toMatchObject({ number: "5511999999999@s.whatsapp.net", mode: "history", count: 100 });
  });
});
