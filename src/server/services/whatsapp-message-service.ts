import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages, whatsappConnections } from "@/db/schema";
import type { TenantContext } from "@/server/auth";
import { normalizeUazapiWebhook, type NormalizedMessage, type WaMessageKind } from "@/server/whatsapp/normalizer";
import { credentialsOf, getConnectionRow } from "@/server/services/whatsapp-connection-service";
import { resolveConversation } from "@/server/services/conversation-resolver";
import { publishInboxEvent } from "@/server/services/inbox-events";
import {
  deleteMessage,
  downloadMessageMedia,
  findMessages,
  markChatRead,
  reactToMessage,
  sendMedia,
  sendPresence,
  sendText,
  type MediaKind,
} from "@/server/whatsapp/uazapi-client";

/**
 * Persistência e envio de mensagens.
 *
 * Duas invariantes atravessam este arquivo:
 *
 * 1. Idempotência — a uazapi reentrega webhooks. Toda gravação é `on conflict
 *    do nothing` sobre (organização, id externo), e o retorno diz se a mensagem
 *    era nova. Sem isso, uma reentrega vira mensagem duplicada no inbox e, pior,
 *    um segundo turno do agente.
 *
 * 2. Fila do inbox — mensagem nova joga a conversa para a fila quando ela não
 *    está atribuída a ninguém, inclusive quando já tinha sido resolvida. Quem
 *    atendeu por último fica registrado como contexto, mas não recebe a
 *    conversa de volta automaticamente.
 */

type ConnectionRow = typeof whatsappConnections.$inferSelect;

const KIND_TO_SENDER_LABEL: Record<WaMessageKind, string> = {
  text: "",
  image: "[imagem]",
  audio: "[áudio]",
  video: "[vídeo]",
  document: "[documento]",
  sticker: "[figurinha]",
  location: "[localização]",
  contact: "[contato]",
  system: "",
  unsupported: "[mensagem não suportada]",
};

export type IngestResult = {
  conversationId: number;
  messageId: number | null;
  customerId: number | null;
  isNew: boolean;
  isInbound: boolean;
};

export async function ingestMessage(connection: ConnectionRow, msg: NormalizedMessage): Promise<IngestResult> {
  const { conversationId, customerId } = await resolveConversation({
    organizationId: connection.organizationId,
    connectionId: connection.id,
    remoteJid: msg.remoteJid,
    phone: msg.phone,
    // Em grupo o título é o nome do grupo; usar quem falou faria a conversa
    // trocar de nome a cada mensagem.
    contactName: msg.isGroup ? msg.groupName : msg.fromMe ? null : msg.senderName,
    isGroup: msg.isGroup,
  });

  const body = msg.body || KIND_TO_SENDER_LABEL[msg.kind] || "";
  const inserted = await db
    .insert(messages)
    .values({
      organizationId: connection.organizationId,
      conversationId,
      direction: msg.fromMe ? "outbound" : "inbound",
      // Mensagem própria que chega pelo webhook foi enviada do celular, fora do
      // sistema: registra como humana, sem dono, e é isso que faz o agente
      // recuar quando alguém assume a conversa pelo aparelho.
      sender: msg.fromMe ? "user" : "customer",
      senderName: msg.fromMe ? null : msg.senderName,
      senderPhone: msg.senderPhone,
      body,
      messageType: msg.kind === "system" ? "system" : msg.kind,
      status: msg.fromMe ? "sent" : "delivered",
      externalId: msg.externalId,
      quotedExternalId: msg.quotedExternalId,
      mediaUrl: msg.mediaUrl,
      mediaMimeType: msg.mediaMimeType,
      mediaFileName: msg.mediaFileName,
      sentAt: msg.sentAt,
    })
    .onConflictDoNothing({ target: [messages.organizationId, messages.externalId] })
    .returning({ id: messages.id });

  const isNew = inserted.length > 0;
  if (!isNew) {
    return { conversationId, messageId: null, customerId, isNew: false, isInbound: !msg.fromMe };
  }

  if (msg.fromMe) {
    await db
      .update(conversations)
      .set({ lastMessageAt: msg.sentAt, lastOutboundAt: msg.sentAt })
      .where(eq(conversations.id, conversationId));
  } else {
    const [current] = await db
      .select({
        assignedUserId: conversations.assignedUserId,
        status: conversations.status,
        resolvedByUserId: conversations.resolvedByUserId,
      })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    const reopening = current?.status === "closed";
    await db
      .update(conversations)
      .set({
        lastMessageAt: msg.sentAt,
        lastInboundAt: msg.sentAt,
        unreadCount: sql`${conversations.unreadCount} + 1`,
        status: "open",
        ...(reopening
          ? {
              resolvedAt: null,
              resolvedByUserId: null,
              lastAssignedUserId: current?.assignedUserId ?? current?.resolvedByUserId ?? null,
              assignedUserId: null,
            }
          : {}),
      })
      .where(eq(conversations.id, conversationId));
  }

  return { conversationId, messageId: inserted[0].id, customerId, isNew: true, isInbound: !msg.fromMe };
}

/** Reconcilia o banco com o histórico já conhecido pela instância. */
export async function syncConversationHistory(
  organizationId: number,
  conversationId: number,
  maxMessages = 200,
): Promise<number> {
  const [conversation] = await db
    .select({ remoteJid: conversations.remoteJid })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .limit(1);
  if (!conversation?.remoteJid) return 0;

  const connection = await getConnectionRow(organizationId);
  if (!connection || connection.status !== "connected") return 0;

  let imported = 0;
  for (let offset = 0; offset < maxMessages; offset += 100) {
    const rows = await findMessages(credentialsOf(connection), {
      chatid: conversation.remoteJid,
      limit: Math.min(100, maxMessages - offset),
      offset,
    });
    for (const raw of [...rows].reverse()) {
      const normalized = normalizeUazapiWebhook({ EventType: "messages", event: raw });
      if (normalized.kind !== "message" || normalized.message.isGroup) continue;
      const result = await ingestMessage(connection, normalized.message);
      if (result.isNew) imported += 1;
    }
    if (rows.length < 100) break;
  }

  if (imported > 0) await publishInboxEvent(organizationId, { type: "message", conversationId });
  return imported;
}

export async function applyStatusUpdate(
  connection: ConnectionRow,
  externalId: string,
  status: "sent" | "delivered" | "read" | "failed",
): Promise<void> {
  // Status só avança: um "delivered" atrasado não pode apagar um "read".
  const rank: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
  const [row] = await db
    .select({ id: messages.id, status: messages.status })
    .from(messages)
    .where(and(eq(messages.organizationId, connection.organizationId), eq(messages.externalId, externalId)))
    .limit(1);
  if (!row) return;
  if (status !== "failed" && rank[status] <= rank[row.status]) return;
  await db.update(messages).set({ status }).where(eq(messages.id, row.id));
}

export type SendOptions = {
  /** Autor humano. Ausente significa envio do agente. */
  senderUserId?: number | null;
  sender: "user" | "ai" | "system";
  media?: { type: MediaKind; url: string; fileName?: string; mimeType?: string };
  /** Id externo da mensagem que está sendo respondida. */
  replyToExternalId?: string;
};

/**
 * Envia e grava. Só existe este caminho de saída — inbox, agente e automações
 * passam por aqui, para que nenhuma regra de envio precise ser reescrita (e
 * esquecida) em outro lugar.
 */
export async function sendMessageToConversation(
  organizationId: number,
  conversationId: number,
  body: string,
  options: SendOptions,
): Promise<{ messageId: number; externalId: string }> {
  const [conversation] = await db
    .select({
      id: conversations.id,
      remoteJid: conversations.remoteJid,
      connectionId: conversations.connectionId,
      assignedUserId: conversations.assignedUserId,
    })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .limit(1);
  if (!conversation) throw new Error("Conversa não encontrada.");
  if (!conversation.remoteJid) throw new Error("Esta conversa não tem número de WhatsApp.");

  const connection = await getConnectionRow(organizationId);
  if (!connection) throw new Error("Nenhuma conexão de WhatsApp configurada.");

  const credentials = credentialsOf(connection);
  const result = options.media
    ? await sendMedia(credentials, conversation.remoteJid, {
        type: options.media.type,
        file: options.media.url,
        caption: body || undefined,
        fileName: options.media.fileName,
        mimetype: options.media.mimeType,
        replyId: options.replyToExternalId,
      })
    : await sendText(credentials, conversation.remoteJid, body, { replyId: options.replyToExternalId });

  const now = new Date();
  const [inserted] = await db
    .insert(messages)
    .values({
      organizationId,
      conversationId,
      direction: "outbound",
      sender: options.sender,
      senderUserId: options.senderUserId ?? null,
      body,
      messageType: options.media ? mediaKindToMessageType(options.media.type) : "text",
      status: "sent",
      externalId: result.messageId,
      // Base64 não é guardado: a linha ficaria com megabytes de texto. Fica a
      // referência, e a mídia vive no WhatsApp.
      mediaUrl: options.media?.url.startsWith("http") ? options.media.url : null,
      mediaFileName: options.media?.fileName ?? null,
      mediaMimeType: options.media?.mimeType ?? null,
      quotedExternalId: options.replyToExternalId ?? null,
      sentAt: now,
    })
    .onConflictDoNothing({ target: [messages.organizationId, messages.externalId] })
    .returning({ id: messages.id });

  await db
    .update(conversations)
    .set({ lastMessageAt: now, lastOutboundAt: now, unreadCount: 0 })
    .where(eq(conversations.id, conversationId));

  // O eco do webhook é deduplicado pelo id externo e, portanto, não publica
  // outro evento. Publicar aqui é o que faz automações e envios da IA surgirem
  // instantaneamente em todas as abas abertas do Inbox.
  await publishInboxEvent(organizationId, { type: "message", conversationId });

  // A mídia enviada chegou como base64 e não deve ocupar megabytes no banco.
  // Recuperar o link do provedor agora mantém foto, vídeo e áudio visíveis
  // depois do reload. Voz aproveita a mesma chamada para ser transcrita.
  if (options.media && !options.media.url.startsWith("http")) {
    try {
      const isAudio = ["audio", "myaudio", "ptt"].includes(options.media.type);
      const apiKey = isAudio ? process.env.OPENAI_API_KEY : undefined;
      const downloaded = await downloadMessageMedia(credentials, result.messageId, {
        returnLink: true,
        transcribe: Boolean(apiKey),
        openaiApiKey: apiKey,
      });
      if (downloaded.url || downloaded.transcription) {
        await db
          .update(messages)
          .set({
            ...(downloaded.url ? { mediaUrl: downloaded.url } : {}),
            ...(downloaded.transcription ? { audioTranscription: downloaded.transcription } : {}),
          })
          .where(and(eq(messages.organizationId, organizationId), eq(messages.externalId, result.messageId)));
      }
    } catch (error) {
      // O WhatsApp já aceitou a mensagem; falha de enriquecimento não pode ser
      // apresentada como falha de envio.
      console.warn("[whatsapp] mídia enviada sem prévia persistida:", error instanceof Error ? error.message : error);
    }
  }

  // Melhor esforço: marcar lido no aparelho é conveniência, não pode derrubar o envio.
  void markChatRead(credentials, conversation.remoteJid).catch(() => {});

  return { messageId: inserted?.id ?? 0, externalId: result.messageId };
}

export type Reaction = { emoji: string; fromMe: boolean; at: string };

/**
 * Aplica uma reação recebida.
 *
 * Cada lado tem no máximo uma reação por mensagem — reagir de novo substitui a
 * anterior, e emoji vazio significa que a pessoa desfez. Guardar como lista
 * mantém as duas pontas visíveis ao mesmo tempo.
 */
export async function applyReaction(
  connection: ConnectionRow,
  targetExternalId: string,
  emoji: string,
  fromMe: boolean,
): Promise<void> {
  const [row] = await db
    .select({ id: messages.id, reactions: messages.reactions })
    .from(messages)
    .where(
      and(eq(messages.organizationId, connection.organizationId), eq(messages.externalId, targetExternalId)),
    )
    .limit(1);
  if (!row) return;

  const atuais = Array.isArray(row.reactions) ? (row.reactions as Reaction[]) : [];
  const semAntiga = atuais.filter((r) => r.fromMe !== fromMe);
  const proximas = emoji ? [...semAntiga, { emoji, fromMe, at: new Date().toISOString() }] : semAntiga;

  await db.update(messages).set({ reactions: proximas }).where(eq(messages.id, row.id));
}

/** Marca como apagada, sem remover a linha: o histórico não pode ganhar buracos. */
export async function markMessageDeleted(connection: ConnectionRow, externalId: string): Promise<void> {
  await db
    .update(messages)
    .set({ deletedAt: new Date() })
    .where(and(eq(messages.organizationId, connection.organizationId), eq(messages.externalId, externalId)));
}

/** Reage a uma mensagem a partir do inbox. */
export async function reactFromInbox(
  organizationId: number,
  conversationId: number,
  messageId: number,
  emoji: string,
): Promise<void> {
  const { connection, conversation, message } = await loadForAction(organizationId, conversationId, messageId);
  if (!message.externalId) throw new Error("Esta mensagem não pode receber reação.");

  await reactToMessage(credentialsOf(connection), conversation.remoteJid!, message.externalId, emoji);
  await applyReaction(connection, message.externalId, emoji, true);
}

/** Apaga para todos. Não há desfazer, no WhatsApp nem aqui. */
export async function deleteFromInbox(
  organizationId: number,
  conversationId: number,
  messageId: number,
): Promise<void> {
  const { connection, message } = await loadForAction(organizationId, conversationId, messageId);
  if (!message.externalId) throw new Error("Esta mensagem não existe no WhatsApp.");

  await deleteMessage(credentialsOf(connection), message.externalId);
  await db.update(messages).set({ deletedAt: new Date() }).where(eq(messages.id, message.id));
}

/**
 * Transcreve um áudio recebido.
 *
 * A própria uazapi transcreve quando recebe uma chave da OpenAI, o que evita
 * montar um segundo pipeline só para ler o que o cliente falou. Sem a chave, o
 * áudio continua tocável na tela, só não vira texto.
 */
export async function transcribeAudio(
  organizationId: number,
  conversationId: number,
  messageId: number,
): Promise<string | null> {
  const { connection, message } = await loadForAction(organizationId, conversationId, messageId);
  if (!message.externalId) return null;
  if (message.audioTranscription) return message.audioTranscription;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Transcrição precisa de uma chave da OpenAI configurada no servidor.");

  const result = await downloadMessageMedia(credentialsOf(connection), message.externalId, {
    transcribe: true,
    openaiApiKey: apiKey,
    returnLink: true,
  });
  if (!result.transcription) return null;

  await db
    .update(messages)
    .set({ audioTranscription: result.transcription, ...(result.url ? { mediaUrl: result.url } : {}) })
    .where(eq(messages.id, message.id));
  return result.transcription;
}

/** Pede à uazapi o link da mídia e guarda para as próximas aberturas. */
export async function fetchMediaUrl(
  organizationId: number,
  conversationId: number,
  messageId: number,
): Promise<string | null> {
  const { connection, message } = await loadForAction(organizationId, conversationId, messageId);
  if (!message.externalId) return null;

  const result = await downloadMessageMedia(credentialsOf(connection), message.externalId, { returnLink: true });
  if (!result.url) return null;

  await db.update(messages).set({ mediaUrl: result.url }).where(eq(messages.id, message.id));
  return result.url;
}

/** Mostra "digitando" ou "gravando" para o cliente. Nunca derruba o envio. */
export async function notifyPresence(
  organizationId: number,
  conversationId: number,
  presence: "composing" | "recording" | "paused",
): Promise<void> {
  const [conversation] = await db
    .select({ remoteJid: conversations.remoteJid })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .limit(1);
  if (!conversation?.remoteJid) return;

  const connection = await getConnectionRow(organizationId);
  if (!connection) return;
  await sendPresence(credentialsOf(connection), conversation.remoteJid, presence).catch(() => {});
}

async function loadForAction(organizationId: number, conversationId: number, messageId: number) {
  const [conversation] = await db
    .select({ id: conversations.id, remoteJid: conversations.remoteJid })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .limit(1);
  if (!conversation) throw new Error("Conversa não encontrada.");

  const [message] = await db
    .select({
      id: messages.id,
      externalId: messages.externalId,
      audioTranscription: messages.audioTranscription,
    })
    .from(messages)
    // `conversationId` no filtro não é redundante: sem ele, um par (conversa,
    // mensagem) forjado deixa reagir, apagar ou transcrever mensagem de OUTRA
    // conversa da mesma clínica — e a reação sai no chat errado, porque ela é
    // enviada para o remoteJid da conversa passada usando o id da mensagem
    // alheia. A checagem por organização sozinha não pega isso.
    .where(
      and(
        eq(messages.id, messageId),
        eq(messages.conversationId, conversationId),
        eq(messages.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!message) throw new Error("Mensagem não encontrada.");

  const connection = await getConnectionRow(organizationId);
  if (!connection) throw new Error("Nenhuma conexão de WhatsApp configurada.");

  return { connection, conversation, message };
}

function mediaKindToMessageType(kind: MediaKind) {
  switch (kind) {
    case "image":
      return "image" as const;
    case "video":
    case "videoplay":
    case "ptv":
      return "video" as const;
    case "audio":
    case "myaudio":
    case "ptt":
      return "audio" as const;
    case "sticker":
      return "sticker" as const;
    default:
      return "document" as const;
  }
}

/** Atalho para uso a partir de uma ação de tela, já com o tenant da sessão. */
export async function sendFromInbox(
  ctx: TenantContext,
  conversationId: number,
  body: string,
  extras: { media?: SendOptions["media"]; replyToExternalId?: string } = {},
) {
  return sendMessageToConversation(ctx.organizationId, conversationId, body, {
    sender: "user",
    senderUserId: ctx.userId,
    media: extras.media,
    replyToExternalId: extras.replyToExternalId,
  });
}
