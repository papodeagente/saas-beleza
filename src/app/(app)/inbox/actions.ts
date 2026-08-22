"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { requireSession } from "@/server/auth";
import { type ConversationDetail, getConversation } from "@/server/services/inbox-service";

export type InboxResult = { ok: true } | { ok: false; error: string };

/** Conversa serializada para o cliente — datas em ISO, nada de Date cru. */
export type InboxDetail = {
  conversationId: number;
  controlledBy: "ai" | "human" | "waiting";
  customerName: string;
  channel: string;
  messages: Array<{
    id: number;
    direction: "inbound" | "outbound";
    sender: "customer" | "user" | "ai" | "system";
    body: string;
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
    channel: detail.conversation.channel,
    messages: detail.messages.map((message) => ({
      ...message,
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
 * Carrega uma conversa isolada.
 *
 * É o que permite trocar de conversa sem recarregar a rota: a lista já está na
 * tela, só as mensagens e o contexto viajam.
 */
export async function loadConversationAction(input: unknown): Promise<InboxDetail | null> {
  try {
    const ctx = await requireSession();
    const conversationId = idSchema.parse(input);
    const detail = await getConversation(ctx, conversationId);
    return detail ? serialize(detail) : null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

const sendSchema = z.object({
  conversationId: idSchema,
  body: z.string().trim().min(1, "Escreva a mensagem antes de enviar.").max(4000),
});

/**
 * Registra uma mensagem do atendente na conversa.
 *
 * Não existe canal conectado: a mensagem fica registrada aqui e a tela diz
 * exatamente isso, para não prometer entrega que não acontece.
 */
export async function sendMessageAction(input: unknown): Promise<InboxResult> {
  try {
    const ctx = await requireSession();
    const data = sendSchema.parse(input);

    const [conversation] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, data.conversationId),
          eq(conversations.organizationId, ctx.organizationId),
        ),
      )
      .limit(1);
    if (!conversation) return { ok: false, error: "Conversa não encontrada." };

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.insert(messages).values({
        organizationId: ctx.organizationId,
        conversationId: data.conversationId,
        direction: "outbound",
        sender: "user",
        body: data.body,
        createdAt: now,
      });
      // Responder assume a conversa: quem fala agora é uma pessoa
      await tx
        .update(conversations)
        .set({ lastMessageAt: now, controlledBy: "human", assignedUserId: ctx.userId })
        .where(eq(conversations.id, data.conversationId));
    });

    revalidatePath("/inbox");
    return { ok: true };
  } catch (error) {
    console.error(error);
    return { ok: false, error: "Não foi possível registrar a mensagem. Tente de novo." };
  }
}

const controlSchema = z.object({
  conversationId: idSchema,
  controlledBy: z.enum(["ai", "human", "waiting"]),
});

/** Devolver o controle para a IA é sempre explícito — nunca automático. */
export async function setControlAction(input: unknown): Promise<InboxResult> {
  try {
    const ctx = await requireSession();
    const data = controlSchema.parse(input);
    const result = await db
      .update(conversations)
      .set({
        controlledBy: data.controlledBy,
        assignedUserId: data.controlledBy === "human" ? ctx.userId : null,
      })
      .where(
        and(
          eq(conversations.id, data.conversationId),
          eq(conversations.organizationId, ctx.organizationId),
        ),
      )
      .returning({ id: conversations.id });
    if (result.length === 0) return { ok: false, error: "Conversa não encontrada." };

    revalidatePath("/inbox");
    return { ok: true };
  } catch (error) {
    console.error(error);
    return { ok: false, error: "Não foi possível mudar o responsável pela conversa." };
  }
}
