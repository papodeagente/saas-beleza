import { describe, expect, it } from "vitest";
import { normalizeUazapiWebhook, normalizeUazapiWebhookBatch } from "./normalizer";
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

  it("trata Type Deleted de messages_update como exclusão", () => {
    const event = normalizeUazapiWebhook({
      EventType: "messages_update",
      event: { MessageIDs: ["DEL-1"], Type: "Deleted", chatid: "5511999999999@s.whatsapp.net" },
    });
    expect(event.kind).toBe("deleted");
    if (event.kind === "deleted") expect(event.externalId).toBe("DEL-1");
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

describe("lotes de histórico", () => {
  it("normaliza todas as mensagens do evento history", () => {
    const events = normalizeUazapiWebhookBatch({
      EventType: "history",
      event: {
        messages: [
          { messageid: "H1", chatid: "120363000000000000@g.us", messageType: "Conversation", text: "uma" },
          { messageid: "H2", chatid: "120363000000000000@g.us", messageType: "Conversation", text: "duas" },
        ],
      },
    });
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.kind)).toEqual(["message", "message"]);
    expect(events.map((event) => event.kind === "message" && event.message.externalId)).toEqual(["H1", "H2"]);
  });
});

/**
 * Status do provedor.
 *
 * Cada payload aqui é o que a instância devolveu de verdade em 24/08/2026: o
 * /message/find responde `"status": "Read"` para mensagens que o banco tinha
 * como "enviada". Ler esse campo é o que desfaz as 627 mensagens presas.
 */
describe("status que a uazapi já conhece", () => {
  it("lê o status da mensagem no formato do /message/find", () => {
    const event = normalizeUazapiWebhook({
      EventType: "messages",
      instanceName: "c",
      event: {
        messageid: "3EB0F008BD7A1CEB1C8896",
        chatid: "5511987654321@s.whatsapp.net",
        fromMe: true,
        messageType: "ExtendedTextMessage",
        text: "Oi, Grace! Seu agendamento foi realizado com sucesso",
        status: "Read",
      },
    });
    if (event.kind !== "message") throw new Error("esperava mensagem");
    expect(event.message.status).toBe("read");
  });

  it("cobre todo o vocabulário de status do provedor", () => {
    const status = (valor: string) => {
      const event = normalizeUazapiWebhook({
        EventType: "messages",
        event: { messageid: `S-${valor}`, chatid: "5511@s.whatsapp.net", messageType: "Conversation", text: "x", status: valor },
      });
      return event.kind === "message" ? event.message.status : "erro";
    };
    expect(status("Sent")).toBe("sent");
    expect(status("Delivered")).toBe("delivered");
    expect(status("Read")).toBe("read");
    expect(status("Played")).toBe("read");
    expect(status("Queued")).toBe("pending");
    expect(status("Failed")).toBe("failed");
    expect(status("Canceled")).toBe("failed");
  });

  it("não inventa status quando o payload não traz nenhum", () => {
    const event = normalizeUazapiWebhook({
      EventType: "messages",
      event: { messageid: "SEM", chatid: "5511@s.whatsapp.net", messageType: "Conversation", text: "oi" },
    });
    if (event.kind !== "message") throw new Error("esperava mensagem");
    expect(event.message.status).toBeNull();
  });

  it("não transforma `ack` vazio em recusa", () => {
    // `Number(null)` e `Number("")` valem 0, e 0 é "recusada" no vocabulário de
    // ACK. Convertendo o candidato sem descartar o vazio antes, um `ack: null`
    // marcava como FALHOU uma mensagem que o cliente já tinha lido — e `failed`
    // vence qualquer estado no ranque, então não haveria como desfazer.
    for (const ack of [null, "", false]) {
      const event = normalizeUazapiWebhook({
        EventType: "messages_update",
        ack,
        event: { MessageIDs: ["ACK_VAZIO"], ack },
      });
      expect(event.kind).toBe("ignored");
    }
  });

  it("lê o ACK numérico mesmo quando o Type ao lado é desconhecido", () => {
    const event = normalizeUazapiWebhook({
      EventType: "messages_update",
      event: { MessageIDs: ["ACK_NUM"], Type: "AlgoQueNaoSabemosLer", ack: 4 },
    });
    expect(event).toMatchObject({ kind: "status", status: "read" });
  });

  it("ignora atualização cujo estado não reconhece, em vez de chamar de enviada", () => {
    // O fallback antigo era "sent": qualquer Type desconhecido virava uma
    // confirmação que ninguém tinha dado, e ainda recarregava a tela.
    const event = normalizeUazapiWebhook({
      EventType: "messages_update",
      event: { MessageIDs: ["X1"], Type: "AlgoNovoQueNaoSabemosLer" },
    });
    expect(event.kind).toBe("ignored");
  });
});

describe("mídia baixada pela uazapi", () => {
  it("guarda a URL nova do arquivo em vez de tratar como confirmação de entrega", () => {
    // Payload real de 24/08/2026: `FileDownloaded` traz a URL servida pela
    // uazapi, a única que abre — a do WhatsApp vem criptografada.
    const event = normalizeUazapiWebhook({
      EventType: "messages_update",
      type: "FileDownloadedMessage",
      instanceName: "Bruno Barbosa - Teste",
      event: {
        Chat: "553199325441@s.whatsapp.net",
        Type: "FileDownloaded",
        chatid: "553199325441@s.whatsapp.net",
        FileURL: "https://enturos.uazapi.com/files/6524169974.jpg",
        MimeType: "image/jpeg",
        MessageIDs: ["3A35148AA7F067CABE2E"],
        IsFromMe: false,
      },
    });
    expect(event).toMatchObject({
      kind: "media",
      externalIds: ["3A35148AA7F067CABE2E"],
      mediaUrl: "https://enturos.uazapi.com/files/6524169974.jpg",
      mediaMimeType: "image/jpeg",
      remoteJid: "553199325441@s.whatsapp.net",
    });
  });

  it("descarta o aviso de download que chega sem URL", () => {
    const event = normalizeUazapiWebhook({
      EventType: "messages_update",
      event: { Type: "FileDownloaded", MessageIDs: ["A1"], FileURL: "" },
    });
    expect(event.kind).toBe("ignored");
  });
});

describe("tipos de mensagem que faltavam", () => {
  it("lê a mensagem com botões antiga como o texto que ela é", () => {
    // Payload real: 45 mensagens desta instância (lembretes, relatórios,
    // campanhas) estavam gravadas como `unsupported` e a bolha as anunciava
    // como "Mensagem não suportada" — com o texto legível impresso logo abaixo.
    const event = normalizeUazapiWebhook({
      EventType: "messages",
      message: {
        messageid: "490BCF316B4C88B624",
        chatid: "5511987654321@s.whatsapp.net",
        messageType: "TemplateMessage",
        fromMe: false,
        status: "",
        text: "*Dia 25, às 20h*, eu vou te mostrar como colocar IA para trabalhar.",
      },
    });
    if (event.kind !== "message") throw new Error("esperava mensagem");
    expect(event.message.kind).toBe("text");
    expect(event.message.body).toContain("Dia 25");
    // `status: ""` é o que o webhook desta instância manda em TODA mensagem:
    // não pode virar um estado inventado.
    expect(event.message.status).toBeNull();
  });

  it("lê a enquete com pergunta e opções", () => {
    const event = normalizeUazapiWebhook({
      EventType: "messages",
      event: {
        messageid: "P1",
        chatid: "5511987654321@s.whatsapp.net",
        messageType: "PollCreationMessage",
        text: "",
        content: {
          name: "Qual horário fica melhor?",
          options: [{ optionName: "14h" }, { optionName: "16h" }],
          selectableOptionsCount: 1,
        },
      },
    });
    if (event.kind !== "message") throw new Error("esperava mensagem");
    expect(event.message.kind).toBe("text");
    expect(event.message.body).toBe("[enquete] Qual horário fica melhor?\n• 14h\n• 16h");
  });

  it("lê o voto da enquete no campo vote", () => {
    const event = normalizeUazapiWebhook({
      EventType: "messages",
      event: {
        messageid: "P2",
        chatid: "5511987654321@s.whatsapp.net",
        messageType: "PollUpdateMessage",
        text: "",
        vote: "16h",
      },
    });
    if (event.kind !== "message") throw new Error("esperava mensagem");
    expect(event.message.body).toBe("[voto na enquete] 16h");
  });

  it("lê a resposta de lista e a de botão", () => {
    const lista = normalizeUazapiWebhook({
      EventType: "messages",
      event: {
        messageid: "L1",
        chatid: "5511987654321@s.whatsapp.net",
        messageType: "ListResponseMessage",
        text: "",
        buttonOrListid: "servico_manutencao",
        content: { title: "Manutenção" },
      },
    });
    if (lista.kind !== "message") throw new Error("esperava mensagem");
    expect(lista.message.body).toBe("[resposta] Manutenção");

    const botao = normalizeUazapiWebhook({
      EventType: "messages",
      event: {
        messageid: "B1",
        chatid: "5511987654321@s.whatsapp.net",
        messageType: "ButtonsResponseMessage",
        text: "",
        buttonOrListid: "confirmar",
        content: {},
      },
    });
    if (botao.kind !== "message") throw new Error("esperava mensagem");
    expect(botao.message.body).toBe("[resposta] confirmar");
  });

  it("extrai latitude e longitude da localização", () => {
    const event = normalizeUazapiWebhook({
      EventType: "messages",
      event: {
        messageid: "G1",
        chatid: "5511987654321@s.whatsapp.net",
        messageType: "LocationMessage",
        text: "",
        content: { degreesLatitude: -9.66581, degreesLongitude: -35.71032, name: "Studio Lumina" },
      },
    });
    if (event.kind !== "message") throw new Error("esperava mensagem");
    expect(event.message.kind).toBe("location");
    expect(event.message.body).toBe("[localização] -9.66581, -35.71032 — Studio Lumina");
  });

  it("extrai nome e telefone do vCard do contato", () => {
    const event = normalizeUazapiWebhook({
      EventType: "messages",
      event: {
        messageid: "C1",
        chatid: "5511987654321@s.whatsapp.net",
        messageType: "ContactMessage",
        text: "",
        content: {
          displayName: "Katiuscy",
          vcard: "BEGIN:VCARD\nVERSION:3.0\nFN:Katiuscy\nTEL;type=CELL:+55 84 99999-1234\nEND:VCARD",
        },
      },
    });
    if (event.kind !== "message") throw new Error("esperava mensagem");
    expect(event.message.kind).toBe("contact");
    expect(event.message.body).toBe("[contato] Katiuscy — +55 84 99999-1234");
  });

  it("reconhece o recado de vídeo, que antes virava não suportada", () => {
    const event = normalizeUazapiWebhook({
      EventType: "messages",
      event: {
        messageid: "V1",
        chatid: "5511987654321@s.whatsapp.net",
        messageType: "PtvMessage",
        fileURL: "https://enturos.uazapi.com/files/video.mp4",
      },
    });
    if (event.kind !== "message") throw new Error("esperava mensagem");
    expect(event.message.kind).toBe("video");
  });

  it("não ingere registro de chamada, que chega como tipo desconhecido e vazio", () => {
    // Nove destes viraram "[mensagem não suportada]" no fio das conversas.
    const event = normalizeUazapiWebhook({
      EventType: "messages",
      event: {
        messageid: "00F9D4432DCC91336F39F941DC626764",
        chatid: "558481282118@s.whatsapp.net",
        messageType: "UnknownMessageType",
        text: "",
        status: "Delivered",
        content: { message: { message: { callLogMesssage: { callOutcome: 1, durationSecs: 0 } } } },
      },
    });
    expect(event.kind).toBe("ignored");
    if (event.kind === "ignored") expect(event.reason).toContain("mensagem_sem_conteudo");
  });

  it("continua gravando tipo desconhecido que TEM texto", () => {
    const event = normalizeUazapiWebhook({
      EventType: "messages",
      event: {
        messageid: "U2",
        chatid: "558481282118@s.whatsapp.net",
        messageType: "TipoQueAindaNaoExiste",
        text: "algo que a cliente escreveu",
      },
    });
    if (event.kind !== "message") throw new Error("esperava mensagem");
    expect(event.message.kind).toBe("unsupported");
    expect(event.message.body).toBe("algo que a cliente escreveu");
  });

  it("descarta o cabeçalho do álbum, porque as mídias vêm em seguida", () => {
    const event = normalizeUazapiWebhook({
      EventType: "messages",
      event: {
        messageid: "AL1",
        chatid: "5511987654321@s.whatsapp.net",
        messageType: "AlbumMessage",
        content: { expectedImageCount: 3 },
      },
    });
    expect(event.kind).toBe("ignored");
    if (event.kind === "ignored") expect(event.reason).toBe("album_cabecalho");
  });
});
