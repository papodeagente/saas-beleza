"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { requireSession } from "@/server/auth";

export type InboxResult = { ok: true } | { ok: false; error: string };

const sendSchema = z.object({
  conversationId: z.number().int().positive(),
  body: z.string().trim().min(1, "Escreva a mensagem antes de enviar.").max(4000),
});

/**
 * Envia uma mensagem do atendente.
 *
 * Nesta fase a mensagem é registrada na conversa mas ainda não sai para o
 * WhatsApp — o MessagingProvider entra na fase 4. O status refletido na tela
 * diz exatamente isso, para não prometer entrega que não aconteceu.
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
      // Assumir a conversa silencia a IA: quem responde agora é uma pessoa
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
  conversationId: z.number().int().positive(),
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
