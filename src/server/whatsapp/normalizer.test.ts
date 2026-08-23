import { describe, expect, it } from "vitest";
import { normalizeUazapiWebhook } from "./normalizer";
import { canonicalBrPhone, phoneFromJid } from "./phone";

/**
 * O payload da uazapi é instável entre versões, e cada formato aqui já chegou
 * de verdade em produção. Estes testes existem para que uma variação conhecida
 * nunca volte a virar "mensagem que some".
 */
describe("normalizeUazapiWebhook", () => {
  it("lê o formato atual, com EventType e o corpo em event", () => {
    const event = normalizeUazapiWebhook({
      EventType: "messages",
      instance: { name: "clinica" },
      event: {
        messageid: "ABC123",
        chatid: "5511987654321@s.whatsapp.net",
        fromMe: false,
        messageType: "Conversation",
        text: "oi, queria marcar",
        senderName: "Marina",
        timestamp: 1_800_000_000,
      },
    });

    expect(event.kind).toBe("message");
    if (event.kind !== "message") return;
    expect(event.message.externalId).toBe("ABC123");
    expect(event.message.body).toBe("oi, queria marcar");
    expect(event.message.kind).toBe("text");
    expect(event.message.phone).toBe("5511987654321");
    expect(event.message.senderName).toBe("Marina");
  });

  it("aceita o formato antigo, com event como nome e o corpo em data", () => {
    const event = normalizeUazapiWebhook({
      event: "messages",
      instanceName: "clinica",
      data: { messageid: "X1", chatid: "5511999999999@s.whatsapp.net", type: "text", text: "olá" },
    });
    expect(event.kind).toBe("message");
  });

  it("desembrulha messages e reconhece mensagem enviada pelo celular", () => {
    const event = normalizeUazapiWebhook({
      event: "messages_upsert",
      data: {
        messages: [{
          key: { id: "CEL1", remoteJid: "5592985621979@s.whatsapp.net", fromMe: "true" },
          messageType: "Conversation",
          text: "respondi pelo aparelho",
        }],
      },
    });
    expect(event).toMatchObject({
      kind: "message",
      message: { externalId: "CEL1", fromMe: true, body: "respondi pelo aparelho" },
    });
  });

  it("troca o chat opaco pelo telefone real quando ele vem em sender_pn", () => {
    const event = normalizeUazapiWebhook({
      EventType: "messages",
      instance: { name: "clinica" },
      event: {
        messageid: "L1",
        chatid: "192837465738291@lid",
        sender_pn: "5511912345678@s.whatsapp.net",
        fromMe: false,
        messageType: "Conversation",
        text: "oi",
      },
    });

    if (event.kind !== "message") throw new Error("esperava mensagem");
    expect(event.message.remoteJid).toBe("5511912345678@s.whatsapp.net");
    expect(event.message.phone).toBe("5511912345678");
  });

  it("reconhece mídia por qualquer um dos nomes de campo usados pela uazapi", () => {
    const event = normalizeUazapiWebhook({
      EventType: "messages",
      instance: { name: "c" },
      event: {
        messageid: "M1",
        chatid: "5511911111111@s.whatsapp.net",
        messageType: "ImageMessage",
        fileURL: "https://cdn.exemplo/img.jpg",
        mimetype: "image/jpeg",
        caption: "ficou assim",
      },
    });

    if (event.kind !== "message") throw new Error("esperava mensagem");
    expect(event.message.kind).toBe("image");
    expect(event.message.mediaUrl).toBe("https://cdn.exemplo/img.jpg");
    expect(event.message.body).toBe("ficou assim");
  });

  it("lê a confirmação de entrega no formato que a uazapi realmente envia", () => {
    // Campos observados em produção: os ids vêm em `MessageIDs` e o estado em
    // `Type`. Ler os nomes documentados descartava toda confirmação.
    const event = normalizeUazapiWebhook({
      EventType: "messages_update",
      instanceName: "Bruno Barbosa - Teste",
      event: {
        Chat: "559285621979@s.whatsapp.net",
        Type: "Delivered",
        MessageIDs: ["3EB0F33525ACA86A54E3AA"],
        IsFromMe: false,
        Timestamp: 1787435684,
      },
    });
    expect(event).toMatchObject({
      kind: "status",
      externalIds: ["3EB0F33525ACA86A54E3AA"],
      status: "delivered",
    });
  });

  it("aceita uma atualização que cobre várias mensagens", () => {
    const event = normalizeUazapiWebhook({
      EventType: "messages_update",
      instanceName: "c",
      event: { Type: "Read", MessageIDs: ["A1", "A2", "A3"] },
    });
    if (event.kind !== "status") throw new Error("esperava status");
    expect(event.externalIds).toEqual(["A1", "A2", "A3"]);
    expect(event.status).toBe("read");
  });

  it("continua entendendo o formato antigo, com id único", () => {
    const event = normalizeUazapiWebhook({
      EventType: "messages_update",
      instance: { name: "c" },
      event: { messageid: "ABC", status: "DELIVERY_ACK" },
    });
    expect(event).toMatchObject({ kind: "status", externalIds: ["ABC"], status: "delivered" });
  });

  it("converte os ACKs numéricos em entregue e lido", () => {
    expect(
      normalizeUazapiWebhook({
        EventType: "messages_update",
        event: { key: { id: "NUM3" }, ack: 3 },
      }),
    ).toMatchObject({ kind: "status", externalIds: ["NUM3"], status: "delivered" });

    expect(
      normalizeUazapiWebhook({
        EventType: "messages_update",
        event: { key: { id: "NUM4" }, ack: 4 },
      }),
    ).toMatchObject({ kind: "status", externalIds: ["NUM4"], status: "read" });
  });

it("reconhece o QR de pareamento e o entrega pronto para exibir", () => {
    const event = normalizeUazapiWebhook({
      EventType: "qrcode",
      instance: { name: "clinica" },
      event: { qrcode: "iVBORw0KGgoAAAANSUhEUg==" },
    });

    expect(event.kind).toBe("qrcode");
    if (event.kind !== "qrcode") return;
    // Sem o prefixo a tag img não renderiza nada, e o pareamento trava sem erro.
    expect(event.qrCode).toBe("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==");
  });

  it("não duplica o prefixo quando o QR já vem como data URI", () => {
    const event = normalizeUazapiWebhook({
      EventType: "qrcode",
      instance: { name: "clinica" },
      event: { qrcode: "data:image/png;base64,AAAA" },
    });
    if (event.kind !== "qrcode") throw new Error("esperava qrcode");
    expect(event.qrCode).toBe("data:image/png;base64,AAAA");
  });

  it("lê mensagem de grupo no formato real: corpo em `message`, chat na raiz", () => {
    // Formato observado em produção: a mensagem vem em `message`, o chat vem
    // fora dela, e quem falou tem nome próprio dentro do grupo.
    const event = normalizeUazapiWebhook({
      EventType: "messages",
      instanceName: "Bruno Barbosa - Teste",
      chat: { wa_chatid: "120363294948429479@g.us", wa_isGroup: true, wa_name: "MANADA MACEIÓ" },
      message: {
        messageid: "3A990FEDB28B9627622E",
        chatid: "120363294948429479@g.us",
        isGroup: true,
        fromMe: false,
        messageType: "Conversation",
        text: "bom dia a todos",
        sender: "169548649083108@lid",
        senderName: "Huyldon Cunha",
        sender_pn: "558287643339@s.whatsapp.net",
        groupName: "MANADA MACEIÓ",
      },
    });

    if (event.kind !== "message") throw new Error("esperava mensagem");
    expect(event.message.remoteJid).toBe("120363294948429479@g.us");
    expect(event.message.isGroup).toBe(true);
    // O título da conversa é o grupo; quem falou é atributo da mensagem.
    expect(event.message.groupName).toBe("MANADA MACEIÓ");
    expect(event.message.senderName).toBe("Huyldon Cunha");
    expect(event.message.senderPhone).toBe("558287643339");
    expect(event.message.body).toBe("bom dia a todos");
  });

  it("não atribui remetente de grupo a uma conversa de duas pessoas", () => {
    const event = normalizeUazapiWebhook({
      EventType: "messages",
      instanceName: "c",
      chat: { wa_chatid: "558481282118@s.whatsapp.net", wa_isGroup: false, wa_name: "Alexandry" },
      message: {
        messageid: "M2",
        chatid: "558481282118@s.whatsapp.net",
        isGroup: false,
        fromMe: false,
        messageType: "Conversation",
        text: "oi",
        senderName: "Alexandry",
        sender_pn: "558481282118@s.whatsapp.net",
      },
    });
    if (event.kind !== "message") throw new Error("esperava mensagem");
    expect(event.message.groupName).toBeNull();
    expect(event.message.senderPhone).toBeNull();
  });

    it("ignora o que não sabe tratar, em vez de inventar mensagem", () => {
    expect(normalizeUazapiWebhook({ EventType: "presence", instance: { name: "c" } }).kind).toBe("ignored");
    expect(normalizeUazapiWebhook(null).kind).toBe("ignored");
    expect(
      normalizeUazapiWebhook({
        EventType: "messages",
        instance: { name: "c" },
        event: { messageid: "R1", chatid: "5511@s.whatsapp.net", messageType: "ReactionMessage", text: "👍" },
      }).kind,
    ).toBe("ignored");
  });
});

describe("identidade de telefone", () => {
  it("não extrai telefone de grupo nem de identidade opaca", () => {
    expect(phoneFromJid("120363000000000000@g.us")).toBeNull();
    expect(phoneFromJid("192837465738291@lid")).toBeNull();
    expect(phoneFromJid("5511987654321@s.whatsapp.net")).toBe("5511987654321");
  });

  it("canoniza o celular brasileiro com e sem o nono dígito", () => {
    expect(canonicalBrPhone("11987654321")).toBe("5511987654321");
    expect(canonicalBrPhone("(11) 98765-4321")).toBe("5511987654321");
    // Sem o nono dígito, o número antigo é normalizado para a forma atual.
    expect(canonicalBrPhone("1187654321")).toBe("5511987654321");
    // Fixo continua fixo: não ganha nono dígito.
    expect(canonicalBrPhone("1132145678")).toBe("551132145678");
  });
});
