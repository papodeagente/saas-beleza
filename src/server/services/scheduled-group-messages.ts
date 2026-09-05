import "server-only";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { scheduledGroupMessages, whatsappGroups } from "@/db/schema";
import type { TenantContext } from "@/server/auth";
import { credentialsOf, getConnectionRow } from "@/server/services/whatsapp-connection-service";
import { getGroup } from "@/server/whatsapp/uazapi-groups";
import { sendMedia, sendText, type MediaKind } from "@/server/whatsapp/uazapi-client";

/**
 * Mensagens programadas para grupos.
 *
 * O disparo é por varredura periódica do que venceu, e não por um temporizador
 * guardado em memória: reiniciar o servidor não pode significar aviso que nunca
 * saiu. Cada linha é reivindicada antes do envio, então duas réplicas rodando a
 * varredura ao mesmo tempo não mandam a mesma mensagem duas vezes.
 */

const TETO_ARQUIVO_BYTES = 5 * 1024 * 1024;

export type ScheduleInput = {
  groupJid: string;
  groupName?: string | null;
  body: string;
  mentionAll: boolean;
  scheduledFor: Date;
  media?: { kind: MediaKind; dataUrl: string; fileName?: string } | null;
};

export type ScheduledItem = {
  id: number;
  groupJid: string;
  body: string;
  mediaKind: string | null;
  mediaFileName: string | null;
  hasMedia: boolean;
  mentionAll: boolean;
  scheduledFor: Date;
  status: "pending" | "sent" | "failed" | "cancelled";
  sentAt: Date | null;
  error: string | null;
};

function mediaKindToColumn(kind: MediaKind) {
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

export async function scheduleGroupMessage(ctx: TenantContext, input: ScheduleInput): Promise<number> {
  if (!input.body.trim() && !input.media) {
    throw new Error("Escreva uma mensagem ou anexe um arquivo.");
  }
  if (input.scheduledFor.getTime() < Date.now() - 60_000) {
    throw new Error("Escolha um horário no futuro.");
  }
  if (input.media) {
    const base64 = input.media.dataUrl.split(",", 2)[1] ?? "";
    if (Math.floor((base64.length * 3) / 4) > TETO_ARQUIVO_BYTES) {
      throw new Error("Arquivo muito grande para agendar. O limite é 5 MB.");
    }
  }

  const [linha] = await db
    .insert(scheduledGroupMessages)
    .values({
      organizationId: ctx.organizationId,
      groupJid: input.groupJid,
      groupName: input.groupName ?? null,
      body: input.body,
      mediaKind: input.media ? mediaKindToColumn(input.media.kind) : null,
      mediaData: input.media?.dataUrl ?? null,
      mediaFileName: input.media?.fileName ?? null,
      mentionAll: input.mentionAll,
      scheduledFor: input.scheduledFor,
      createdByUserId: ctx.userId || null,
    })
    .returning({ id: scheduledGroupMessages.id });
  return linha.id;
}

export async function listScheduledForGroup(ctx: TenantContext, groupJid: string): Promise<ScheduledItem[]> {
  const linhas = await db
    .select({
      id: scheduledGroupMessages.id,
      groupJid: scheduledGroupMessages.groupJid,
      body: scheduledGroupMessages.body,
      mediaKind: scheduledGroupMessages.mediaKind,
      mediaFileName: scheduledGroupMessages.mediaFileName,
      // O arquivo em si nunca sai do servidor: só interessa saber que existe.
      hasMedia: sql<boolean>`${scheduledGroupMessages.mediaData} is not null`,
      mentionAll: scheduledGroupMessages.mentionAll,
      scheduledFor: scheduledGroupMessages.scheduledFor,
      status: scheduledGroupMessages.status,
      sentAt: scheduledGroupMessages.sentAt,
      error: scheduledGroupMessages.error,
    })
    .from(scheduledGroupMessages)
    .where(
      and(
        eq(scheduledGroupMessages.organizationId, ctx.organizationId),
        eq(scheduledGroupMessages.groupJid, groupJid),
      ),
    )
    .orderBy(desc(scheduledGroupMessages.scheduledFor))
    .limit(30);
  return linhas as ScheduledItem[];
}

export async function cancelScheduled(ctx: TenantContext, id: number): Promise<void> {
  const resultado = await db
    .update(scheduledGroupMessages)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(scheduledGroupMessages.id, id),
        eq(scheduledGroupMessages.organizationId, ctx.organizationId),
        eq(scheduledGroupMessages.status, "pending"),
      ),
    )
    .returning({ id: scheduledGroupMessages.id });
  if (resultado.length === 0) throw new Error("Este agendamento já saiu ou foi cancelado.");
}

/**
 * Envia o que venceu.
 *
 * Cada linha é reivindicada com um UPDATE condicional antes do envio: quem
 * consegue mudar o status é quem manda, e as outras réplicas não veem mais a
 * linha. Sem isso, duas varreduras simultâneas mandariam a mesma mensagem.
 */
export async function dispatchDueMessages(limite = 10): Promise<{ sent: number; failed: number }> {
  const vencidas = await db
    .select({
      id: scheduledGroupMessages.id,
      organizationId: scheduledGroupMessages.organizationId,
      groupJid: scheduledGroupMessages.groupJid,
      body: scheduledGroupMessages.body,
      mediaKind: scheduledGroupMessages.mediaKind,
      mediaData: scheduledGroupMessages.mediaData,
      mediaFileName: scheduledGroupMessages.mediaFileName,
      mentionAll: scheduledGroupMessages.mentionAll,
    })
    .from(scheduledGroupMessages)
    .where(
      and(
        eq(scheduledGroupMessages.status, "pending"),
        lte(scheduledGroupMessages.scheduledFor, new Date()),
      ),
    )
    .orderBy(asc(scheduledGroupMessages.scheduledFor))
    .limit(limite);

  let sent = 0;
  let failed = 0;

  for (const item of vencidas) {
    // Reivindica: só segue quem conseguiu tirar a linha de "pending".
    const reivindicada = await db
      .update(scheduledGroupMessages)
      .set({ status: "sent", sentAt: new Date() })
      .where(and(eq(scheduledGroupMessages.id, item.id), eq(scheduledGroupMessages.status, "pending")))
      .returning({ id: scheduledGroupMessages.id });
    if (reivindicada.length === 0) continue;

    try {
      const connection = await getConnectionRow(item.organizationId);
      if (!connection) throw new Error("Nenhuma conexão de WhatsApp configurada.");
      const credenciais = credentialsOf(connection);

      let mentions: string[] | undefined;
      if (item.mentionAll) {
        // A lista de quem está no grupo vem na hora do envio: entre o
        // agendamento e agora, gente entra e sai.
        const grupo = await getGroup(credenciais, item.groupJid);
        mentions = grupo.participants.map((p) => p.phone).filter((p): p is string => Boolean(p));
      }

      if (item.mediaData && item.mediaKind) {
        await sendMedia(credenciais, item.groupJid, {
          type: item.mediaKind === "audio" ? "ptt" : (item.mediaKind as MediaKind),
          file: item.mediaData,
          caption: item.body || undefined,
          fileName: item.mediaFileName ?? undefined,
        });
      } else {
        await sendText(credenciais, item.groupJid, item.body, { mentions });
      }

      // O arquivo já cumpriu seu papel; guardar megabytes de base64 para sempre
      // só engorda o banco.
      await db
        .update(scheduledGroupMessages)
        .set({ mediaData: null })
        .where(eq(scheduledGroupMessages.id, item.id));

      // Retrato do grupo para a lista, sem custo extra.
      await db
        .update(whatsappGroups)
        .set({ updatedAt: new Date() })
        .where(
          and(
            eq(whatsappGroups.organizationId, item.organizationId),
            eq(whatsappGroups.jid, item.groupJid),
          ),
        );
      sent += 1;
    } catch (error) {
      failed += 1;
      const detalhe = error instanceof Error ? error.message : "falha desconhecida";
      console.error(`[agendadas] envio ${item.id} falhou:`, detalhe);
      await db
        .update(scheduledGroupMessages)
        .set({ status: "failed", error: detalhe.slice(0, 500), sentAt: null })
        .where(eq(scheduledGroupMessages.id, item.id));
    }
  }

  return { sent, failed };
}
