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
  sentAt: Date;
};

export type WaEvent =
  | { kind: "message"; instance: string; message: NormalizedMessage }
  | {
      kind: "status";
      instance: string;
      /** Uma atualização pode cobrir várias mensagens de uma vez. */
      externalIds: string[];
      status: "sent" | "delivered" | "read" | "failed";
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
  | { kind: "ignored"; reason: string };

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
};

function toDate(value: Json): Date {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return new Date();
  // A uazapi alterna entre segundos e milissegundos no mesmo campo.
  return new Date(n > 1e12 ? n : n * 1000);
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
    const numericStatus = rawStatus
      ? Number(rawStatus)
      : (asNumber(get(body, "ack")) ?? asNumber(get(raw, "ack")) ?? Number.NaN);
    const status =
      rawStatus.includes("read") || rawStatus.includes("played") || numericStatus >= 4
        ? "read"
        : rawStatus.includes("deliver") || numericStatus === 3
          ? "delivered"
          : rawStatus.includes("error") || rawStatus.includes("fail") || numericStatus === 0
            ? "failed"
            : "sent";
    if (externalIds.length === 0) return { kind: "ignored", reason: "status_sem_id" };
    return { kind: "status", instance, externalIds, status };
  }

  const isMessageEvent =
    eventName === "messages" ||
    eventName === "message" ||
    eventName === "messages.upsert" ||
    (!eventName && (get(body, "messageid") || get(body, "chatid")));
  if (!isMessageEvent) return { kind: "ignored", reason: `evento_nao_suportado:${eventName || "?"}` };

  const msg: Json = Array.isArray(body) ? body[0] : body;
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
    get(msg, "fromMe") === true ||
    get(msg, "from_me") === true ||
    get(msg, "IsFromMe") === true ||
    get(msg, "key", "fromMe") === true;
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

  const text = firstString(
    get(msg, "text"),
    get(msg, "content", "text"),
    get(msg, "message", "conversation"),
    get(msg, "message", "extendedTextMessage", "text"),
    get(msg, "content"),
    get(msg, "body"),
    get(msg, "caption"),
    get(msg, "message", "imageMessage", "caption"),
    get(msg, "message", "videoMessage", "caption"),
  );

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
      sentAt: toDate(get(msg, "timestamp") ?? get(msg, "messageTimestamp") ?? get(msg, "t")),
    },
  };
}
