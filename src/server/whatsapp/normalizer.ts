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

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Primeiro valor string não vazio — o padrão de leitura defensiva deste módulo. */
function firstString(...candidates: unknown[]): string {
  for (const c of candidates) {
    const s = str(c);
    if (s) return s;
  }
  return "";
}

function toDate(value: unknown): Date {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return new Date();
  // A uazapi alterna entre segundos e milissegundos no mesmo campo.
  return new Date(n > 1e12 ? n : n * 1000);
}

export function normalizeUazapiWebhook(raw: any): WaEvent {
  if (!raw || typeof raw !== "object") return { kind: "ignored", reason: "payload_vazio" };

  const instance = firstString(
    raw.instanceName,
    raw.instance?.name,
    typeof raw.instance === "string" ? raw.instance : "",
    raw.name,
  );

  // `event` pode ser o NOME do evento (string) ou o próprio corpo (objeto).
  const eventName = firstString(
    raw.EventType,
    typeof raw.event === "string" ? raw.event : "",
    typeof raw.type === "string" ? raw.type : "",
  ).toLowerCase();
  const body = (typeof raw.event === "object" && raw.event) || raw.data || raw.message || raw;

  // A uazapi emite um QR novo sozinha quando o anterior expira. Guardar esse
  // evento é o que mantém a tela de pareamento com um código sempre válido.
  if (eventName === "qrcode" || eventName === "qr" || body?.qrcode) {
    const qr = firstString(body?.qrcode, raw.qrcode, body?.qr, raw.qr);
    return {
      kind: "qrcode",
      instance,
      qrCode: qr ? (qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`) : null,
      pairCode: firstString(body?.paircode, raw.paircode) || null,
    };
  }

  if (eventName === "connection" || eventName.includes("connect") || raw.connection) {
    const status = firstString(raw.connection, body?.connection, raw.instance?.status, body?.status).toLowerCase();
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
    const idSources = [body?.MessageIDs, body?.messageids, body?.messageIds, body?.ids];
    let externalIds: string[] = [];
    for (const source of idSources) {
      if (Array.isArray(source) && source.length > 0) {
        externalIds = source.map((id: unknown) => str(id)).filter(Boolean);
        break;
      }
    }
    if (externalIds.length === 0) {
      const single = firstString(body?.messageid, body?.messageId, body?.id, raw.messageid, raw.id);
      if (single) externalIds = [single];
    }

    const rawStatus = firstString(body?.Type, body?.status, body?.update, raw.status).toLowerCase();
    const status =
      rawStatus.includes("read") || rawStatus.includes("played")
        ? "read"
        : rawStatus.includes("deliver")
          ? "delivered"
          : rawStatus.includes("error") || rawStatus.includes("fail")
            ? "failed"
            : "sent";
    if (externalIds.length === 0) return { kind: "ignored", reason: "status_sem_id" };
    return { kind: "status", instance, externalIds, status };
  }

  const isMessageEvent =
    eventName === "messages" ||
    eventName === "message" ||
    eventName === "messages.upsert" ||
    (!eventName && (body?.messageid || body?.chatid));
  if (!isMessageEvent) return { kind: "ignored", reason: `evento_nao_suportado:${eventName || "?"}` };

  const msg = Array.isArray(body) ? body[0] : body;
  if (!msg || typeof msg !== "object") return { kind: "ignored", reason: "mensagem_vazia" };

  let remoteJid = firstString(
    msg.remoteJid,
    msg.chatid,
    msg.chatId,
    msg.wa_chatid,
    msg.Chat?.wa_chatid,
    msg.chat?.wa_chatid,
    msg.key?.remoteJid,
  );
  if (!remoteJid) return { kind: "ignored", reason: "sem_remote_jid" };

  const fromMe: boolean = msg.fromMe === true || msg.from_me === true || msg.IsFromMe === true || msg.key?.fromMe === true;
  const isGroup = isGroupJid(remoteJid);

  /**
   * Em conversa privada o WhatsApp às vezes entrega o chat como LID (identidade
   * opaca) mesmo tendo o telefone real em `sender_pn`. Preferir o telefone evita
   * criar uma segunda conversa para o mesmo cliente.
   */
  if (!isGroup && !fromMe) {
    const senderPn = firstString(msg.sender_pn, msg.senderPn, msg.participant_pn);
    const chatDigits = digitsOnly(remoteJid.split("@")[0] ?? "");
    const chatIsOpaque = isLidJid(remoteJid) || isLikelyLid(chatDigits);
    if (chatIsOpaque && senderPn) {
      const pnDigits = digitsOnly(senderPn.split("@")[0] ?? "");
      if (pnDigits && !isLikelyLid(pnDigits)) remoteJid = `${pnDigits}@s.whatsapp.net`;
    }
  }

  const externalId = firstString(msg.messageid, msg.messageId, msg.id, msg.key?.id);
  if (!externalId) return { kind: "ignored", reason: "sem_message_id" };

  const rawType = firstString(msg.messageType, msg.type);
  if (rawType === "ReactionMessage" || rawType === "reactionMessage" || rawType === "reaction") {
    return { kind: "ignored", reason: "reacao" };
  }

  const kind: WaMessageKind =
    TYPE_ALIASES[rawType] ??
    (msg.image ? "image" : msg.video ? "video" : msg.audio ? "audio" : msg.document ? "document" : rawType ? "unsupported" : "text");

  const text = firstString(
    msg.text,
    msg.content?.text,
    msg.message?.conversation,
    msg.message?.extendedTextMessage?.text,
    typeof msg.content === "string" ? msg.content : "",
    msg.body,
    msg.caption,
    msg.message?.imageMessage?.caption,
    msg.message?.videoMessage?.caption,
  );

  const mediaUrl =
    firstString(
      msg.fileURL,
      msg.fileUrl,
      msg.mediaUrl,
      msg.url,
      msg.URL,
      msg.message?.imageMessage?.url,
      msg.message?.videoMessage?.url,
      msg.message?.audioMessage?.url,
      msg.message?.documentMessage?.url,
    ) || null;

  const mediaMimeType =
    firstString(
      msg.mimetype,
      msg.contentType,
      msg.message?.imageMessage?.mimetype,
      msg.message?.videoMessage?.mimetype,
      msg.message?.audioMessage?.mimetype,
      msg.message?.documentMessage?.mimetype,
    ) || null;

  const quotedExternalId =
    firstString(msg.quoted, msg.quotedMessageId, msg.message?.extendedTextMessage?.contextInfo?.stanzaId) || null;

  return {
    kind: "message",
    instance,
    message: {
      externalId,
      remoteJid,
      fromMe,
      isGroup,
      phone: phoneFromJid(remoteJid),
      senderName: firstString(msg.senderName, msg.pushName, msg.sender_name, msg.Chat?.wa_name, msg.chat?.name) || null,
      kind,
      body: text,
      mediaUrl,
      mediaMimeType,
      mediaFileName: firstString(msg.fileName, msg.docName, msg.message?.documentMessage?.fileName) || null,
      quotedExternalId,
      sentAt: toDate(msg.timestamp ?? msg.messageTimestamp ?? msg.t),
    },
  };
}
