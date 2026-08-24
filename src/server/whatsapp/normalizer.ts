/**
 * Webhook da uazapi → evento canônico.
 *
 * O payload da uazapi é instável: o nome do evento aparece em `EventType` ou
 * `event`, o mesmo campo vem em PascalCase, camelCase ou snake_case conforme a
 * versão, e o corpo ora está na raiz, ora em `event`, ora em `data`. Ler um só
 * lugar produz silêncio — mensagem que chega e some. Por isso cada campo é lido
 * de todas as fontes conhecidas, na ordem em que se provaram confiáveis no
 * entur-os-crm.
 *
 * Módulo puro: sem banco, sem rede, testável isoladamente.
 */

import { asArray, asNumber, asString, firstString, get, type Json } from "./json";
import { digitsOnly, isGroupJid, isLidJid, isLikelyLid, phoneFromJid } from "./phone";

export type WaMessageKind =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "sticker"
  | "location"
  | "contact"
  | "system"
  | "unsupported";

/** Ciclo de vida de uma mensagem, no mesmo vocabulário do banco. */
export type WaMessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";

export type NormalizedMessage = {
  externalId: string;
  remoteJid: string;
  fromMe: boolean;
  isGroup: boolean;
  phone: string | null;
  senderName: string | null;
  /** Telefone de quem falou dentro do grupo; nulo em conversa de duas pessoas. */
  senderPhone: string | null;
  /** Nome do grupo. Em grupo, o título da conversa é ele, não quem falou. */
  groupName: string | null;
  kind: WaMessageKind;
  body: string;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaFileName: string | null;
  quotedExternalId: string | null;
  /**
   * Status que o provedor JÁ conhece para esta mensagem.
   *
   * O /message/find devolve `Sent`, `Delivered` ou `Read` em toda mensagem, e
   * o webhook de mensagem também traz o campo. Ignorá-lo era o que fazia a
   * reconciliação regravar "enviada" por cima de uma mensagem que o cliente
   * já tinha lido. Nulo quando o payload não diz nada a respeito.
   */
  status: WaMessageStatus | null;
  sentAt: Date;
};

export type WaEvent =
  | { kind: "message"; instance: string; message: NormalizedMessage }
  | {
      kind: "status";
      instance: string;
      /** Uma atualização pode cobrir várias mensagens de uma vez. */
      externalIds: string[];
      status: WaMessageStatus;
    }
  | { kind: "connection"; instance: string; status: string; connected: boolean }
  | { kind: "qrcode"; instance: string; qrCode: string | null; pairCode: string | null }
  | {
      kind: "reaction";
      instance: string;
      /** Mensagem que recebeu a reação. */
      targetExternalId: string;
      /** Vazio significa que a pessoa desfez a reação. */
      emoji: string;
      fromMe: boolean;
      remoteJid: string;
    }
  | { kind: "deleted"; instance: string; externalId: string; remoteJid: string }
  | {
      /**
       * A uazapi terminou de baixar a mídia e a hospedou em servidor próprio.
       * É a única chance de guardar uma URL que abre: a do WhatsApp vem
       * criptografada e sem chave, e a do provedor não é reemitida.
       */
      kind: "media";
      instance: string;
      externalIds: string[];
      mediaUrl: string;
      mediaMimeType: string | null;
      remoteJid: string;
    }
  | { kind: "ignored"; reason: string };

/**
 * Estado do provedor → estado nosso.
 *
 * O vocabulário oficial do /message/find é `Queued`, `Canceled`, `Failed`,
 * `Sent`, `Delivered`, `Read`; o webhook acrescenta `Played` (áudio ouvido) e
 * as versões antigas mandam ACK numérico (3 = entregue, 4 = lida). Devolve
 * nulo quando não há informação de status, que é diferente de "foi enviada":
 * inventar `sent` nesse caso era o que fazia o Inbox mentir.
 */
export function statusFromProvider(raw: Json, ack?: Json): WaMessageStatus | null {
  const texto = asString(raw).toLowerCase();
  if (texto) {
    if (texto.includes("read") || texto.includes("played")) return "read";
    if (texto.includes("deliver")) return "delivered";
    if (texto.includes("error") || texto.includes("fail") || texto.includes("cancel")) return "failed";
    if (texto.includes("queue") || texto.includes("pending")) return "pending";
    if (texto.includes("sent") || texto.includes("ack")) return "sent";
  }
  /**
   * O ACK numérico é lido candidato a candidato, e o vazio é descartado ANTES
   * de virar número.
   *
   * `Number(null)`, `Number("")` e `Number(false)` valem 0 — e 0 é justamente
   * o código de "recusada" no vocabulário de ACK. Convertendo em bloco, um
   * `ack: null` no payload marcaria como FALHOU uma mensagem que o cliente já
   * tinha lido, e `failed` vence qualquer estado no ranque: o estrago não teria
   * volta. Testar um por vez também impede que um `Type` desconhecido (texto
   * não vazio que não casa com nenhuma palavra) esconda um ACK válido ao lado.
   */
  for (const bruto of [texto, ack]) {
    if (bruto === null || bruto === undefined || bruto === "" || typeof bruto === "boolean") continue;
    const numero = asNumber(bruto);
    if (numero === null) continue;
    if (numero >= 4) return "read";
    if (numero === 3) return "delivered";
    if (numero === 1 || numero === 2) return "sent";
    if (numero === 0) return "failed";
  }
  return null;
}

const TYPE_ALIASES: Record<string, WaMessageKind> = {
  Conversation: "text",
  ExtendedTextMessage: "text",
  conversation: "text",
  extendedTextMessage: "text",
  text: "text",
  ImageMessage: "image",
  imageMessage: "image",
  image: "image",
  VideoMessage: "video",
  videoMessage: "video",
  video: "video",
  AudioMessage: "audio",
  audioMessage: "audio",
  audio: "audio",
  PttMessage: "audio",
  pttMessage: "audio",
  ptt: "audio",
  DocumentMessage: "document",
  documentMessage: "document",
  document: "document",
  StickerMessage: "sticker",
  stickerMessage: "sticker",
  sticker: "sticker",
  LocationMessage: "location",
  locationMessage: "location",
  location: "location",
  ContactMessage: "contact",
  contactMessage: "contact",
  contact: "contact",
  // Cartão de contato com mais de uma pessoa dentro.
  ContactsArrayMessage: "contact",
  contactsArrayMessage: "contact",
  LiveLocationMessage: "location",
  liveLocationMessage: "location",
  // Vídeo redondo ("recado de vídeo"). Chega desta instância como PtvMessage e
  // caía em "não suportada" — era vídeo o tempo todo.
  PtvMessage: "video",
  ptvMessage: "video",
  ptv: "video",
  /**
   * Enquete, resposta de lista e resposta de botão viram texto de propósito.
   *
   * O tipo do banco (`wa_message_type`) é o vocabulário que a tela sabe
   * desenhar; inventar valores novos exigiria migração de enum e um desenho
   * novo de bolha para cada um. O que a atendente precisa ler — a pergunta, as
   * opções, o voto, o botão escolhido — é montado em `body` logo abaixo.
   */
  PollCreationMessage: "text",
  pollCreationMessage: "text",
  PollCreationMessageV2: "text",
  PollCreationMessageV3: "text",
  poll: "text",
  PollUpdateMessage: "text",
  pollUpdateMessage: "text",
  ListResponseMessage: "text",
  listResponseMessage: "text",
  ButtonsResponseMessage: "text",
  buttonsResponseMessage: "text",
  TemplateButtonReplyMessage: "text",
  templateButtonReplyMessage: "text",
  /**
   * `TemplateMessage` é o formato antigo de mensagem com botões, e o texto dele
   * chega inteiro em `text` como em qualquer outra.
   *
   * Era o tipo desconhecido MAIS comum nesta instância: 45 mensagens
   * perfeitamente legíveis (lembretes, relatórios, campanhas) estavam gravadas
   * como `unsupported`, e a bolha as anunciava com o rótulo "Mensagem não
   * suportada" antes de imprimir o texto que estava logo ali.
   */
  TemplateMessage: "text",
  templateMessage: "text",
  HydratedTemplateMessage: "text",
  hydratedTemplateMessage: "text",
  InteractiveResponseMessage: "text",
  interactiveResponseMessage: "text",
  ListMessage: "text",
  listMessage: "text",
  ButtonsMessage: "text",
  buttonsMessage: "text",
};

/**
 * Corpo legível para os tipos cujo conteúdo não vem em `text`.
 *
 * A uazapi entrega a mensagem original em `content` (a struct do whatsmeow
 * serializada). Sem ler dali, enquete virava linha vazia, localização virava
 * "[localização]" sem lugar nenhum e cartão de contato não tinha nem o nome.
 */
function bodyFromContent(msg: Json, rawType: string): string {
  const content = get(msg, "content");
  const tipo = rawType.toLowerCase();

  if (tipo.includes("location")) {
    const lat = primeiroNumero(get(content, "degreesLatitude"), get(content, "latitude"), get(msg, "latitude"));
    const lng = primeiroNumero(get(content, "degreesLongitude"), get(content, "longitude"), get(msg, "longitude"));
    const lugar = firstString(get(content, "name"), get(content, "address"), get(msg, "address"));
    if (lat === null || lng === null) return lugar ? `[localização] ${lugar}` : "";
    // Coordenada primeiro: é o que permite abrir no mapa mesmo sem nome.
    return `[localização] ${lat}, ${lng}${lugar ? ` — ${lugar}` : ""}`;
  }

  if (tipo.includes("contact")) {
    const cartoes = asArray(get(content, "contacts"));
    const lista = cartoes.length > 0 ? cartoes : [content];
    const pessoas = lista
      .map((cartao) => {
        const nome = firstString(get(cartao, "displayName"), get(cartao, "name"));
        const telefone = telefoneDoVcard(asString(get(cartao, "vcard")));
        return [nome, telefone].filter(Boolean).join(" — ");
      })
      .filter(Boolean);
    return pessoas.length > 0 ? `[contato] ${pessoas.join(" | ")}` : "";
  }

  if (tipo.includes("pollcreation") || tipo === "poll") {
    const pergunta = firstString(get(content, "name"), get(content, "question"), get(msg, "text"));
    const opcoes = asArray(get(content, "options"))
      .map((opcao) => firstString(get(opcao, "optionName"), get(opcao, "name"), opcao))
      .filter(Boolean);
    if (!pergunta && opcoes.length === 0) return "";
    return `[enquete] ${pergunta}${opcoes.length > 0 ? `\n${opcoes.map((o) => `• ${o}`).join("\n")}` : ""}`;
  }

  if (tipo.includes("pollupdate")) {
    // `vote` é o campo que a uazapi usa para voto de enquete e de lista.
    const voto = firstString(get(msg, "vote"), get(content, "vote"));
    return voto ? `[voto na enquete] ${voto}` : "";
  }

  if (tipo.includes("response") || tipo.includes("buttonreply")) {
    const escolha = firstString(
      get(msg, "text"),
      get(content, "title"),
      get(content, "selectedDisplayText"),
      get(content, "displayText"),
      get(msg, "vote"),
      get(msg, "buttonOrListid"),
      get(content, "selectedRowID"),
      get(content, "selectedButtonID"),
    );
    return escolha ? `[resposta] ${escolha}` : "";
  }

  return "";
}

/** Primeiro número aproveitável — a uazapi manda coordenada ora número, ora texto. */
function primeiroNumero(...candidatos: Json[]): number | null {
  for (const candidato of candidatos) {
    if (candidato === null || candidato === undefined || candidato === "") continue;
    const numero = asNumber(candidato);
    if (numero !== null) return numero;
  }
  return null;
}

/** Só o telefone interessa do vCard: o resto não cabe numa bolha de conversa. */
function telefoneDoVcard(vcard: string): string {
  const linha = vcard.split(/\r?\n/).find((l) => l.toUpperCase().startsWith("TEL"));
  if (!linha) return "";
  return (linha.split(":").pop() ?? "").trim();
}

function toDate(value: Json): Date {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return new Date();
  // A uazapi alterna entre segundos e milissegundos no mesmo campo.
  return new Date(n > 1e12 ? n : n * 1000);
}

function trueLike(value: Json): boolean {
  return value === true || value === 1 || (typeof value === "string" && ["true", "1", "yes"].includes(value.toLowerCase()));
}

export function normalizeUazapiWebhook(raw: Json): WaEvent {
  if (!raw || typeof raw !== "object") return { kind: "ignored", reason: "payload_vazio" };

  const instance = firstString(
    get(raw, "instanceName"),
    get(raw, "instance", "name"),
    get(raw, "instance"),
    get(raw, "name"),
  );

  // `event` pode ser o NOME do evento (string) ou o próprio corpo (objeto).
  const evento = get(raw, "event");
  const eventName = firstString(get(raw, "EventType"), evento, get(raw, "type")).toLowerCase();
  const body: Json =
    (evento !== null && typeof evento === "object" ? evento : undefined) ??
    get(raw, "data") ??
    get(raw, "message") ??
    raw;

  // A uazapi emite um QR novo sozinha quando o anterior expira. Guardar esse
  // evento é o que mantém a tela de pareamento com um código sempre válido.
  if (eventName === "qrcode" || eventName === "qr" || get(body, "qrcode")) {
    const qr = firstString(get(body, "qrcode"), get(raw, "qrcode"), get(body, "qr"), get(raw, "qr"));
    return {
      kind: "qrcode",
      instance,
      qrCode: qr ? (qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`) : null,
      pairCode: firstString(get(body, "paircode"), get(raw, "paircode")) || null,
    };
  }

  if (eventName === "connection" || eventName.includes("connect") || get(raw, "connection")) {
    const status = firstString(
      get(raw, "connection"),
      get(body, "connection"),
      get(raw, "instance", "status"),
      get(body, "status"),
    ).toLowerCase();
    return {
      kind: "connection",
      instance,
      status: status || "unknown",
      connected: status === "connected" || status === "open",
    };
  }

  if (eventName === "messages_update" || eventName === "message_update" || eventName === "messages.update") {
    /**
     * O formato real entrega os ids em `MessageIDs` (lista) e o estado em
     * `Type` — nomes diferentes dos que a documentação sugere. Ler só os nomes
     * documentados fazia toda confirmação de entrega ser descartada, e a
     * mensagem ficava eternamente como "enviada" na tela.
     */
    const idSources = [
      get(body, "MessageIDs"),
      get(body, "messageids"),
      get(body, "messageIds"),
      get(body, "ids"),
      get(raw, "MessageIDs"),
      get(raw, "messageIds"),
    ];
    let externalIds: string[] = [];
    for (const source of idSources) {
      const lista = asArray(source);
      if (lista.length > 0) {
        externalIds = lista.map(asString).filter(Boolean);
        break;
      }
    }
    if (externalIds.length === 0) {
      const single = firstString(
        get(body, "messageid"),
        get(body, "messageId"),
        get(body, "id"),
        get(raw, "messageid"),
        get(raw, "id"),
        get(body, "key", "id"),
        get(raw, "key", "id"),
      );
      if (single) externalIds = [single];
    }

    const rawStatus = firstString(
      get(body, "Type"),
      get(body, "status"),
      get(body, "update"),
      get(raw, "status"),
      get(body, "ack"),
      get(raw, "ack"),
    ).toLowerCase();
    const remoteJidDoUpdate = firstString(
      get(body, "chatid"),
      get(body, "Chat"),
      get(body, "remoteJid"),
      get(body, "key", "remoteJid"),
      get(raw, "chatid"),
    );
    if (rawStatus.includes("delete")) {
      if (externalIds.length === 0) return { kind: "ignored", reason: "exclusao_sem_id" };
      return {
        kind: "deleted",
        instance,
        externalId: externalIds[0],
        remoteJid: remoteJidDoUpdate,
      };
    }

    /**
     * `FileDownloaded` não é estado de entrega: é o aviso de que a mídia foi
     * baixada e reservida pela uazapi, com uma URL que ABRE — a do WhatsApp
     * vem criptografada. Tratá-lo como status enterrava essa URL (o único
     * momento em que ela chega sozinha) e ainda mandava toda aba recarregar
     * a tela por uma mudança que não era de status.
     */
    if (rawStatus.includes("filedownload")) {
      const mediaUrl = firstString(get(body, "FileURL"), get(body, "fileURL"), get(body, "fileUrl"), get(raw, "FileURL"));
      if (externalIds.length === 0 || !mediaUrl) return { kind: "ignored", reason: "midia_sem_id_ou_url" };
      return {
        kind: "media",
        instance,
        externalIds,
        mediaUrl,
        mediaMimeType: firstString(get(body, "MimeType"), get(body, "mimetype"), get(body, "mimeType")) || null,
        remoteJid: remoteJidDoUpdate,
      };
    }

    if (externalIds.length === 0) return { kind: "ignored", reason: "status_sem_id" };
    const status = statusFromProvider(rawStatus, get(body, "ack") ?? get(raw, "ack"));
    // Sem status reconhecido não há o que gravar. O fallback antigo era `sent`,
    // e ele fabricava uma confirmação que ninguém tinha dado.
    if (!status) return { kind: "ignored", reason: `atualizacao_sem_status:${rawStatus || "?"}` };
    return { kind: "status", instance, externalIds, status };
  }

  const isMessageEvent =
    eventName === "messages" ||
    eventName === "message" ||
    eventName === "messages.upsert" ||
    eventName === "messages_upsert" ||
    eventName === "message.received" ||
    eventName === "message.sent" ||
    (!eventName && (get(body, "messageid") || get(body, "chatid")));
  if (!isMessageEvent) return { kind: "ignored", reason: `evento_nao_suportado:${eventName || "?"}` };

  const nestedMessages = asArray(get(body, "messages"));
  const nestedMessage = get(body, "message");
  const msg: Json = Array.isArray(body)
    ? body[0]
    : nestedMessages[0] ?? (nestedMessage && typeof nestedMessage === "object" ? nestedMessage : body);
  if (!msg || typeof msg !== "object") return { kind: "ignored", reason: "mensagem_vazia" };

  let remoteJid = firstString(
    get(msg, "remoteJid"),
    get(msg, "chatid"),
    get(msg, "chatId"),
    get(msg, "wa_chatid"),
    get(msg, "Chat", "wa_chatid"),
    get(msg, "chat", "wa_chatid"),
    get(msg, "key", "remoteJid"),
    // O formato real põe o chat FORA da mensagem, na raiz do payload.
    get(raw, "chat", "wa_chatid"),
  );
  if (!remoteJid) return { kind: "ignored", reason: "sem_remote_jid" };

  const fromMe =
    trueLike(get(msg, "fromMe")) ||
    trueLike(get(msg, "from_me")) ||
    trueLike(get(msg, "IsFromMe")) ||
    trueLike(get(msg, "key", "fromMe"));
  const isGroup = isGroupJid(remoteJid);

  /**
   * Em conversa privada o WhatsApp às vezes entrega o chat como LID (identidade
   * opaca) mesmo tendo o telefone real em `sender_pn`. Preferir o telefone evita
   * criar uma segunda conversa para o mesmo cliente.
   */
  if (!isGroup && !fromMe) {
    const senderPn = firstString(get(msg, "sender_pn"), get(msg, "senderPn"), get(msg, "participant_pn"));
    const chatDigits = digitsOnly(remoteJid.split("@")[0] ?? "");
    const chatIsOpaque = isLidJid(remoteJid) || isLikelyLid(chatDigits);
    if (chatIsOpaque && senderPn) {
      const pnDigits = digitsOnly(senderPn.split("@")[0] ?? "");
      if (pnDigits && !isLikelyLid(pnDigits)) remoteJid = `${pnDigits}@s.whatsapp.net`;
    }
  }

  const externalId = firstString(get(msg, "messageid"), get(msg, "messageId"), get(msg, "id"), get(msg, "key", "id"));
  if (!externalId) return { kind: "ignored", reason: "sem_message_id" };

  const messageStatus = firstString(get(msg, "status"), get(msg, "Type")).toLowerCase();
  if (messageStatus.includes("delete")) {
    return { kind: "deleted", instance, externalId, remoteJid };
  }

  const rawType = firstString(get(msg, "messageType"), get(msg, "type"));

  if (rawType === "ReactionMessage" || rawType === "reactionMessage" || rawType === "reaction") {
    // O emoji vem no texto e o alvo em `reaction`; sem o alvo não há o que
    // marcar, então o evento é descartado.
    const targetExternalId = firstString(
      get(msg, "reaction"),
      get(msg, "reactionMessageId"),
      get(msg, "message", "reactionMessage", "key", "id"),
      get(msg, "quoted"),
    );
    if (!targetExternalId) return { kind: "ignored", reason: "reacao_sem_alvo" };
    return {
      kind: "reaction",
      instance,
      targetExternalId,
      emoji: firstString(get(msg, "text"), get(msg, "reactionText")),
      fromMe,
      remoteJid,
    };
  }

  if (rawType === "ProtocolMessage" || eventName === "messages_delete" || get(msg, "isDeleted") === true) {
    const deletedId = firstString(
      get(msg, "deletedMessageId"),
      get(msg, "message", "protocolMessage", "key", "id"),
      get(msg, "quoted"),
    );
    if (deletedId) return { kind: "deleted", instance, externalId: deletedId, remoteJid };
  }

  /**
   * Álbum é só o cabeçalho de um conjunto: as fotos e os vídeos chegam logo
   * depois como mensagens próprias. Ingerir o cabeçalho criaria uma bolha
   * vazia antes das mídias reais, então ele é reconhecido para ser descartado
   * de propósito — e não por acidente, como acontecia ao cair em "não
   * suportada".
   */
  if (rawType.toLowerCase().includes("album")) return { kind: "ignored", reason: "album_cabecalho" };

  const kind: WaMessageKind =
    TYPE_ALIASES[rawType] ??
    (get(msg, "image")
      ? "image"
      : get(msg, "video")
        ? "video"
        : get(msg, "audio")
          ? "audio"
          : get(msg, "document")
            ? "document"
            : rawType
              ? "unsupported"
              : "text");

  const text =
    firstString(
      get(msg, "text"),
      get(msg, "content", "text"),
      get(msg, "message", "conversation"),
      get(msg, "message", "extendedTextMessage", "text"),
      get(msg, "content"),
      get(msg, "body"),
      get(msg, "caption"),
      get(msg, "message", "imageMessage", "caption"),
      get(msg, "message", "videoMessage", "caption"),
    ) ||
    // Enquete, voto, resposta de lista, localização e cartão de contato não
    // têm `text`: o conteúdo mora na struct crua, em `content`.
    bodyFromContent(msg, rawType);

  const mediaUrl =
    firstString(
      get(msg, "fileURL"),
      get(msg, "fileUrl"),
      get(msg, "mediaUrl"),
      get(msg, "url"),
      get(msg, "URL"),
      get(msg, "message", "imageMessage", "url"),
      get(msg, "message", "videoMessage", "url"),
      get(msg, "message", "audioMessage", "url"),
      get(msg, "message", "documentMessage", "url"),
    ) || null;

  const mediaMimeType =
    firstString(
      get(msg, "mimetype"),
      get(msg, "contentType"),
      get(msg, "message", "imageMessage", "mimetype"),
      get(msg, "message", "videoMessage", "mimetype"),
      get(msg, "message", "audioMessage", "mimetype"),
      get(msg, "message", "documentMessage", "mimetype"),
    ) || null;

  const quotedExternalId =
    firstString(
      get(msg, "quoted"),
      get(msg, "quotedMessageId"),
      get(msg, "message", "extendedTextMessage", "contextInfo", "stanzaId"),
    ) || null;

  /**
   * Tipo que não sabemos ler E sem nada dentro não vira mensagem.
   *
   * O caso real são os registros de chamada (`UnknownMessageType` com
   * `callLogMesssage` e texto vazio): nove deles entraram no fio como
   * "[mensagem não suportada]", sem informar nada a quem lê. Um tipo
   * desconhecido COM texto continua sendo gravado — aí existe conteúdo de
   * verdade, e perdê-lo seria pior do que exibi-lo sem formatação.
   */
  if (kind === "unsupported" && !text && !mediaUrl) {
    return { kind: "ignored", reason: `mensagem_sem_conteudo:${rawType || "?"}` };
  }

  return {
    kind: "message",
    instance,
    message: {
      externalId,
      remoteJid,
      fromMe,
      isGroup,
      phone: phoneFromJid(remoteJid),
      groupName: isGroup
        ? firstString(get(msg, "groupName"), get(raw, "chat", "wa_name"), get(raw, "chat", "name")) || null
        : null,
      senderPhone: isGroup
        ? phoneFromJid(
            firstString(get(msg, "sender_pn"), get(msg, "participant"), get(msg, "sender"), get(msg, "Sender")),
          )
        : null,
      senderName:
        firstString(
          get(msg, "senderName"),
          get(msg, "pushName"),
          get(msg, "sender_name"),
          get(msg, "Chat", "wa_name"),
          get(msg, "chat", "name"),
        ) || null,
      kind,
      body: text,
      mediaUrl,
      mediaMimeType,
      mediaFileName:
        firstString(get(msg, "fileName"), get(msg, "docName"), get(msg, "message", "documentMessage", "fileName")) ||
        null,
      quotedExternalId,
      // O mesmo campo `status` que o /message/find devolve em toda mensagem:
      // é ele que corrige retroativamente o que ficou preso em "enviada".
      status: statusFromProvider(messageStatus),
      sentAt: toDate(get(msg, "timestamp") ?? get(msg, "messageTimestamp") ?? get(msg, "t")),
    },
  };
}

/**
 * `history` e algumas versões de `messages` agrupam várias mensagens num só
 * payload. O normalizador unitário permanece útil para eventos normais; este
 * adaptador garante que o webhook não descarte tudo depois do primeiro item.
 */
export function normalizeUazapiWebhookBatch(raw: Json): WaEvent[] {
  if (!raw || typeof raw !== "object") return [normalizeUazapiWebhook(raw)];
  const evento = get(raw, "event");
  const eventName = firstString(get(raw, "EventType"), evento, get(raw, "type")).toLowerCase();
  const body: Json =
    (evento !== null && typeof evento === "object" ? evento : undefined) ??
    get(raw, "data") ??
    get(raw, "message") ??
    raw;
  let rows = Array.isArray(body)
    ? body
    : asArray(get(body, "messages") ?? (eventName === "history" ? get(body, "data") : null));
  if (
    eventName === "history" &&
    rows.length === 0 &&
    (get(body, "messageid") || get(body, "messageId") || get(body, "chatid"))
  ) {
    rows = [body];
  }
  if (rows.length === 0 || (rows.length === 1 && eventName !== "history")) {
    return [normalizeUazapiWebhook(raw)];
  }

  const outer = !Array.isArray(raw) ? (raw as Record<string, Json>) : {};
  const chat = get(raw, "chat") ?? get(body, "chat");
  return rows.map((message) =>
    normalizeUazapiWebhook({
      ...outer,
      EventType: "messages",
      event: message,
      ...(chat ? { chat } : {}),
    }),
  );
}
