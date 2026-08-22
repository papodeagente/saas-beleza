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

  it("traduz atualização de status para o vocabulário interno", () => {
    const event = normalizeUazapiWebhook({
      EventType: "messages_update",
      instance: { name: "c" },
      event: { messageid: "ABC", status: "DELIVERY_ACK" },
    });
    expect(event).toMatchObject({ kind: "status", externalId: "ABC", status: "delivered" });
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
