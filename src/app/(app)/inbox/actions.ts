"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { conversations } from "@/db/schema";
import { requireSession } from "@/server/auth";
import { clearUnread } from "@/server/services/conversation-resolver";
import {
  type ConversationDetail,
  type InboxTab,
  getConversation,
  listConversations,
} from "@/server/services/inbox-service";
import {
  deleteFromInbox,
  notifyPresence,
  fetchMediaUrl,
  reactFromInbox,
  sendFromInbox,
  transcribeAudio,
} from "@/server/services/whatsapp-message-service";

export type InboxResult = { ok: true } | { ok: false; error: string };

/** Conversa serializada para o cliente — datas em ISO, nada de Date cru. */
export type InboxDetail = {
  conversationId: number;
  controlledBy: "ai" | "human" | "waiting";
  customerName: string;
  phone: string | null;
  channel: string;
  status: string;
  aiPaused: boolean;
  assignedUserId: number | null;
  assignedUserName: string | null;
  lastAssignedUserName: string | null;
  hasWhatsapp: boolean;
  messages: Array<{
    id: number;
    direction: "inbound" | "outbound";
    sender: "customer" | "user" | "ai" | "system";
    senderName: string | null;
    body: string;
    messageType: string;
    status: string;
    mediaUrl: string | null;
    mediaMimeType: string | null;
    mediaFileName: string | null;
    audioTranscription: string | null;
    externalId: string | null;
    quotedExternalId: string | null;
    reactions: Array<{ emoji: string; fromMe: boolean }> | null;
    deleted: boolean;
    createdAt: string;
  }>;
  context: {
    customerId: number;
    name: string;
    phone: string | null;
    visitsCount: number;
    totalSpentCents: number;
    lastVisitAt: string | null;
    nextAppointment: { startsAt: string; serviceName: string; professionalName: string } | null;
  } | null;
};

function serialize(detail: ConversationDetail): InboxDetail {
  return {
    conversationId: detail.conversation.id,
    controlledBy: detail.conversation.controlledBy,
    customerName: detail.conversation.customerName,
    phone: detail.conversation.phone,
    channel: detail.conversation.channel,
    status: detail.conversation.status,
    aiPaused: detail.conversation.aiPaused,
    assignedUserId: detail.conversation.assignedUserId,
    assignedUserName: detail.conversation.assignedUserName,
    lastAssignedUserName: detail.conversation.lastAssignedUserName,
    hasWhatsapp: detail.conversation.hasWhatsapp,
    messages: detail.messages.map(({ deletedAt, ...message }) => ({
      ...message,
      reactions: Array.isArray(message.reactions) ? message.reactions : null,
      deleted: deletedAt !== null,
      createdAt: message.createdAt.toISOString(),
    })),
    context: detail.context
      ? {
          ...detail.context,
          lastVisitAt: detail.context.lastVisitAt?.toISOString() ?? null,
          nextAppointment: detail.context.nextAppointment
            ? {
                ...detail.context.nextAppointment,
                startsAt: detail.context.nextAppointment.startsAt.toISOString(),
              }
            : null,
        }
      : null,
  };
}

const idSchema = z.number().int().positive();

/**
 * Carrega uma conversa isolada e zera o não lido.
 *
 * É o que permite trocar de conversa sem recarregar a rota: a lista já está na
 * tela, só as mensagens e o contexto viajam.
 */
export async function loadConversationAction(input: unknown): Promise<InboxDetail | null> {
  try {
    const ctx = await requireSession();
    const conversationId = idSchema.parse(input);
    const detail = await getConversation(ctx, conversationId);
    if (!detail) return null;
    await clearUnread(ctx.organizationId, conversationId);
    return serialize(detail);
  } catch (error) {
    console.error(error);
    return null;
  }
}

/** Recarrega a lista sem sair da rota — usado pela troca de aba e pela busca. */
export async function listConversationsAction(input: {
  tab: InboxTab;
  search?: string;
}): Promise<
  Array<Omit<Awaited<ReturnType<typeof listConversations>>[number], "lastMessageAt"> & { lastMessageAt: string | null }>
> {
  const ctx = await requireSession();
  const rows = await listConversations(ctx, { tab: input.tab, search: input.search });
  return rows.map((row) => ({ ...row, lastMessageAt: row.lastMessageAt?.toISOString() ?? null }));
}

const sendSchema = z.object({
  conversationId: idSchema,
  body: z.string().trim().min(1, "Escreva a mensagem antes de enviar.").max(4000),
  /** Id da mensagem sendo respondida, no formato do provedor. */
  replyToExternalId: z.string().trim().max(120).optional(),
});

/**
 * Envia a mensagem do atendente pelo WhatsApp.
 *
 * Responder assume a conversa: quem fala agora é uma pessoa, então a conversa
 * passa a ser dela e o agente recua. Isso é intencional e é o que a atendente
 * espera ao digitar.
 */
export async function sendMessageAction(input: unknown): Promise<InboxResult> {
  try {
    const ctx = await requireSession();
    const data = sendSchema.parse(input);

    const [conversation] = await db
      .select({ id: conversations.id, assignedUserId: conversations.assignedUserId })
      .from(conversations)
      .where(and(eq(conversations.id, data.conversationId), eq(conversations.organizationId, ctx.organizationId)))
      .limit(1);
    if (!conversation) return { ok: false, error: "Conversa não encontrada." };

    await sendFromInbox(ctx, data.conversationId, data.body, { replyToExternalId: data.replyToExternalId });

    await db
      .update(conversations)
      .set({
        controlledBy: "human",
        assignedUserId: ctx.userId,
        assignedAt: conversation.assignedUserId === ctx.userId ? undefined : new Date(),
        status: "open",
        resolvedAt: null,
      })
      .where(eq(conversations.id, data.conversationId));

    revalidatePath("/inbox");
    return { ok: true };
  } catch (error) {
    console.error(error);
    const message =
      error instanceof Error && error.message.includes("conexão")
        ? "Conecte o WhatsApp em Configurações antes de responder."
        : error instanceof Error
          ? error.message
          : "Não foi possível enviar a mensagem.";
    return { ok: false, error: message };
  }
}

const assignSchema = z.object({
  conversationId: idSchema,
  action: z.enum(["assumir", "devolver", "resolver", "reabrir"]),
});

/**
 * Dono da conversa e estado da fila.
 *
 * "Devolver" não escolhe outra pessoa: a conversa volta para a fila e quem
 * estiver livre puxa. Quem atendeu por último fica registrado como contexto.
 */
export async function updateAssignmentAction(input: unknown): Promise<InboxResult> {
  try {
    const ctx = await requireSession();
    const data = assignSchema.parse(input);

    const patch =
      data.action === "assumir"
        ? { assignedUserId: ctx.userId, assignedAt: new Date(), status: "open" as const, resolvedAt: null, controlledBy: "human" as const }
        : data.action === "devolver"
          ? { assignedUserId: null, lastAssignedUserId: ctx.userId, assignedAt: null }
          : data.action === "resolver"
            ? { status: "closed" as const, resolvedAt: new Date(), resolvedByUserId: ctx.userId, lastAssignedUserId: ctx.userId, assignedUserId: null }
            : { status: "open" as const, resolvedAt: null, resolvedByUserId: null, assignedUserId: ctx.userId };

    const result = await db
      .update(conversations)
      .set(patch)
      .where(and(eq(conversations.id, data.conversationId), eq(conversations.organizationId, ctx.organizationId)))
      .returning({ id: conversations.id });
    if (result.length === 0) return { ok: false, error: "Conversa não encontrada." };

    revalidatePath("/inbox");
    return { ok: true };
  } catch (error) {
    console.error(error);
    return { ok: false, error: "Não foi possível atualizar a conversa." };
  }
}

const pauseSchema = z.object({ conversationId: idSchema, paused: z.boolean() });

/**
 * Pausa e retomada do agente nesta conversa.
 *
 * Enquanto pausado, nenhum caminho automático envia mensagem aqui — a
 * verificação é refeita imediatamente antes de cada envio do agente, porque a
 * pausa pode acontecer enquanto ele está formulando a resposta.
 */
export async function setAiPauseAction(input: unknown): Promise<InboxResult> {
  try {
    const ctx = await requireSession();
    const data = pauseSchema.parse(input);

    const result = await db
      .update(conversations)
      .set({
        aiPausedAt: data.paused ? new Date() : null,
        aiPausedByUserId: data.paused ? ctx.userId : null,
        controlledBy: data.paused ? "human" : "ai",
      })
      .where(and(eq(conversations.id, data.conversationId), eq(conversations.organizationId, ctx.organizationId)))
      .returning({ id: conversations.id });
    if (result.length === 0) return { ok: false, error: "Conversa não encontrada." };

    revalidatePath("/inbox");
    return { ok: true };
  } catch (error) {
    console.error(error);
    return { ok: false, error: "Não foi possível mudar a pausa da IA." };
  }
}

const MAX_ANEXO_BYTES = 10 * 1024 * 1024;

const mediaSchema = z.object({
  conversationId: idSchema,
  /** Arquivo em data URI, como o navegador entrega ao ler o anexo. */
  dataUrl: z.string().startsWith("data:").max(16_000_000),
  kind: z.enum(["image", "video", "document", "audio", "ptt", "sticker"]),
  fileName: z.string().trim().max(200).optional(),
  caption: z.string().trim().max(1000).optional(),
  replyToExternalId: z.string().trim().max(120).optional(),
});

/**
 * Envia um anexo.
 *
 * O arquivo chega em base64 e segue assim para a uazapi, sem passar por
 * armazenamento nosso. Simples e sem infraestrutura extra, com o preço de um
 * teto de tamanho: acima disso o caminho certo é hospedar o arquivo e mandar a
 * URL, o que fica para quando houver storage.
 */
export async function sendMediaAction(input: unknown): Promise<InboxResult> {
  try {
    const ctx = await requireSession();
    const data = mediaSchema.parse(input);

    const [cabecalho, base64] = data.dataUrl.split(",", 2);
    if (!base64) return { ok: false, error: "Arquivo inválido." };
    // 4 caracteres de base64 representam 3 bytes.
    const bytes = Math.floor((base64.length * 3) / 4);
    if (bytes > MAX_ANEXO_BYTES) {
      return { ok: false, error: "Arquivo muito grande. O limite é 10 MB." };
    }
    const mimeType = cabecalho.match(/data:([^;]+)/)?.[1];

    await sendFromInbox(ctx, data.conversationId, data.caption ?? "", {
      media: { type: data.kind, url: data.dataUrl, fileName: data.fileName, mimeType },
      replyToExternalId: data.replyToExternalId,
    });

    await db
      .update(conversations)
      .set({ controlledBy: "human", assignedUserId: ctx.userId, status: "open", resolvedAt: null })
      .where(and(eq(conversations.id, data.conversationId), eq(conversations.organizationId, ctx.organizationId)));

    revalidatePath("/inbox");
    return { ok: true };
  } catch (error) {
    console.error(error);
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível enviar o arquivo." };
  }
}

const reactSchema = z.object({
  conversationId: idSchema,
  messageId: idSchema,
  /** Vazio remove a reação, como no WhatsApp. */
  emoji: z.string().max(8),
});

export async function reactAction(input: unknown): Promise<InboxResult> {
  try {
    const ctx = await requireSession();
    const data = reactSchema.parse(input);
    await reactFromInbox(ctx.organizationId, data.conversationId, data.messageId, data.emoji);
    revalidatePath("/inbox");
    return { ok: true };
  } catch (error) {
    console.error(error);
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível reagir." };
  }
}

const messageSchema = z.object({ conversationId: idSchema, messageId: idSchema });

/** Apaga para todos. Não há desfazer. */
export async function deleteMessageAction(input: unknown): Promise<InboxResult> {
  try {
    const ctx = await requireSession();
    const data = messageSchema.parse(input);
    await deleteFromInbox(ctx.organizationId, data.conversationId, data.messageId);
    revalidatePath("/inbox");
    return { ok: true };
  } catch (error) {
    console.error(error);
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível apagar." };
  }
}

/**
 * Busca a mídia de uma mensagem que chegou sem link.
 *
 * A uazapi nem sempre inclui a URL no webhook. Em vez de mostrar uma bolha
 * vazia, a tela oferece carregar sob demanda — e o link fica salvo para as
 * próximas aberturas da conversa.
 */
export async function loadMediaAction(
  input: unknown,
): Promise<{ ok: true; url: string | null } | { ok: false; error: string }> {
  try {
    const ctx = await requireSession();
    const data = messageSchema.parse(input);
    const url = await fetchMediaUrl(ctx.organizationId, data.conversationId, data.messageId);
    revalidatePath("/inbox");
    return { ok: true, url };
  } catch (error) {
    console.error(error);
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível carregar a mídia." };
  }
}

export async function transcribeAction(
  input: unknown,
): Promise<{ ok: true; text: string | null } | { ok: false; error: string }> {
  try {
    const ctx = await requireSession();
    const data = messageSchema.parse(input);
    const text = await transcribeAudio(ctx.organizationId, data.conversationId, data.messageId);
    revalidatePath("/inbox");
    return { ok: true, text };
  } catch (error) {
    console.error(error);
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível transcrever." };
  }
}

const presenceSchema = z.object({
  conversationId: idSchema,
  presence: z.enum(["composing", "recording", "paused"]),
});

/** Mostra "digitando" para o cliente. Melhor esforço: falha aqui não interessa. */
export async function presenceAction(input: unknown): Promise<void> {
  try {
    const ctx = await requireSession();
    const data = presenceSchema.parse(input);
    await notifyPresence(ctx.organizationId, data.conversationId, data.presence);
  } catch {
    /* silencioso de propósito */
  }
}
