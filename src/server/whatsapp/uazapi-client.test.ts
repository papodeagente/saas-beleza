import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listAddressBook,
  recipientId,
  requestMessageHistory,
  sendMedia,
  sendPresence,
  sendText,
} from "./uazapi-client";

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

/**
 * Marcar como lida ao responder.
 *
 * A conversa continuava em negrito no celular do dono depois de a atendente
 * responder pelo sistema — e o contador de não lidas do aparelho não zerava
 * por lá. `readchat` limpa a conversa e `readmessages` põe o tique azul no que
 * a cliente escreveu. Os dois campos existem em `/send/text` e `/send/media`
 * (openapi da uazapi), e só devem sair quando quem respondeu foi gente.
 */
describe("responder marca como lida", () => {
  it("envia readchat e readmessages quando a resposta é de uma pessoa", async () => {
    const chamadas = capturarChamadas();
    await sendText(CREDS, "5511999999999@s.whatsapp.net", "já te retorno", { markRead: true });
    expect(chamadas[0].body.readchat).toBe(true);
    expect(chamadas[0].body.readmessages).toBe(true);
  });

  it("omite os dois campos no envio automático", async () => {
    // Lembrete e resposta do agente não leram nada: apagar o não lido do
    // aparelho aqui esconderia justamente a mensagem que precisa de gente.
    const chamadas = capturarChamadas();
    await sendText(CREDS, "5511999999999@s.whatsapp.net", "seu horário é amanhã");
    expect(chamadas[0].body).not.toHaveProperty("readchat");
    expect(chamadas[0].body).not.toHaveProperty("readmessages");
  });

  it("vale também para mídia", async () => {
    const chamadas = capturarChamadas();
    await sendMedia(CREDS, "5511999999999@s.whatsapp.net", {
      type: "image",
      file: "https://exemplo.test/foto.jpg",
      markRead: true,
    });
    expect(chamadas[0].url).toBe("https://instancia.test/send/media");
    expect(chamadas[0].body.readchat).toBe(true);
  });
});

describe("pedido de histórico antigo", () => {
  it("ancora na mensagem mais antiga que já temos", async () => {
    // Sem âncora a uazapi parte do acervo DELA: numa conversa que ela nunca
    // viu não há de onde partir e o pedido volta 400 "âncora insuficiente".
    const chamadas = capturarChamadas({ ok: true });
    await requestMessageHistory(CREDS, "5511999999999@s.whatsapp.net", 100, "MSG-MAIS-ANTIGA");
    expect(chamadas[0].url).toBe("https://instancia.test/message/history-sync");
    expect(chamadas[0].body.messageid).toBe("MSG-MAIS-ANTIGA");
    // JID inteiro: podado, o pedido morria sem erro visível.
    expect(chamadas[0].body.number).toBe("5511999999999@s.whatsapp.net");
  });

  it("omite a âncora quando não temos nenhuma mensagem", async () => {
    const chamadas = capturarChamadas({ ok: true });
    await requestMessageHistory(CREDS, "5511999999999@s.whatsapp.net", 100, null);
    expect(chamadas[0].body).not.toHaveProperty("messageid");
  });
});

/**
 * Agenda do aparelho.
 *
 * É de onde o WhatsApp tira o nome que aparece na tela. Sem ela a aba Membros
 * só conseguia nomear quem já tinha escrito no privado.
 */
describe("agenda do aparelho", () => {
  it("lê nome e JID, pedindo só quem está salvo", async () => {
    const chamadas = capturarChamadas({
      contacts: [
        { jid: "556799813556@s.whatsapp.net", contact_name: "Oswaldo Fernandes", contact_FirstName: "Oswaldo" },
        { jid: "5584911112222@s.whatsapp.net", contact_name: "", contact_FirstName: "Marlene" },
      ],
    });
    const agenda = await listAddressBook(CREDS, { limit: 1000, offset: 0 });
    expect(chamadas[0].url).toBe("https://instancia.test/contacts/list");
    // "all" traria também os desconhecidos, com o nome mascarado.
    expect(chamadas[0].body.contactScope).toBe("address_book");
    expect(agenda).toEqual([
      { jid: "556799813556@s.whatsapp.net", name: "Oswaldo Fernandes" },
      // Sem `contact_name`, o primeiro nome ainda serve.
      { jid: "5584911112222@s.whatsapp.net", name: "Marlene" },
    ]);
  });

  it("descarta linha sem nome ou sem identificador", async () => {
    capturarChamadas({ contacts: [{ jid: "", contact_name: "Fulano" }, { jid: "5584@s.whatsapp.net" }] });
    expect(await listAddressBook(CREDS)).toEqual([]);
  });
});
