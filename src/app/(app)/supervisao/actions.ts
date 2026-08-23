"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, requireSession } from "@/server/auth";
import {
  assignConversation,
  getSupervisionSnapshot,
  type SupervisionSnapshot,
} from "@/server/services/supervision-service";

export type SupervisionResult = { ok: true } | { ok: false; error: string };

/** Recarrega o painel sem trocar de rota — o supervisor deixa a tela aberta. */
export async function refreshSupervisionAction(): Promise<SupervisionSnapshot | null> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    return await getSupervisionSnapshot(ctx);
  } catch (error) {
    console.error(error);
    return null;
  }
}

const assignSchema = z.object({
  conversationId: z.number().int().positive(),
  userId: z.number().int().positive(),
});

export async function assignConversationAction(input: unknown): Promise<SupervisionResult> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    const data = assignSchema.parse(input);
    await assignConversation(ctx, data.conversationId, data.userId);
    revalidatePath("/supervisao");
    revalidatePath("/inbox");
    return { ok: true };
  } catch (error) {
    console.error(error);
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível atribuir." };
  }
}
