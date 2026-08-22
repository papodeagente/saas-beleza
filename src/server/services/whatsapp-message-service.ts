import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages, whatsappConnections } from "@/db/schema";
import type { TenantContext } from "@/server/auth";
import type { NormalizedMessage, WaMessageKind } from "@/server/whatsapp/normalizer";
import { credentialsOf, getConnectionRow } from "@/server/services/whatsapp-connection-service";
import { resolveConversation } from "@/server/services/conversation-resolver";
import { markChatRead, sendMedia, sendText, type MediaKind } from "@/server/whatsapp/uazapi-client";

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
    contactName: msg.fromMe ? null : msg.senderName,
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
  media?: { type: MediaKind; url: string; fileName?: string };
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
      })
    : await sendText(credentials, conversation.remoteJid, body);

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
      mediaUrl: options.media?.url ?? null,
      mediaFileName: options.media?.fileName ?? null,
      sentAt: now,
    })
    .onConflictDoNothing({ target: [messages.organizationId, messages.externalId] })
    .returning({ id: messages.id });

  await db
    .update(conversations)
    .set({ lastMessageAt: now, lastOutboundAt: now, unreadCount: 0 })
    .where(eq(conversations.id, conversationId));

  // Melhor esforço: marcar lido no aparelho é conveniência, não pode derrubar o envio.
  void markChatRead(credentials, conversation.remoteJid).catch(() => {});

  return { messageId: inserted?.id ?? 0, externalId: result.messageId };
}

function mediaKindToMessageType(kind: MediaKind) {
  switch (kind) {
    case "image":
      return "image" as const;
    case "video":
    case "ptv":
      return "video" as const;
    case "audio":
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
  media?: SendOptions["media"],
) {
  return sendMessageToConversation(ctx.organizationId, conversationId, body, {
    sender: "user",
    senderUserId: ctx.userId,
    media,
  });
}
