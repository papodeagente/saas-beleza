"use server";

import { revalidatePath } from "next/cache";

import { z } from "zod";
import { requireRole, requireSession } from "@/server/auth";
import {
  cancelScheduled,
  listScheduledForGroup,
  scheduleGroupMessage,
} from "@/server/services/scheduled-group-messages";
import {
  classifyGroup,
  getGroupThread,
  listGroupInbox,
  rememberGroupSize,
  toggleGroupPinned,
  type GroupInboxPage,
} from "@/server/services/group-inbox-service";
import { credentialsOf, getConnectionRow } from "@/server/services/whatsapp-connection-service";
import {
  createGroup,
  getGroup,
  joinGroup,
  leaveGroup,
  listGroups,
  resetInviteCode,
  setJoinApproval,
  setOnlyAdminsEdit,
  setOnlyAdminsSend,
  updateGroupDescription,
  updateGroupName,
  updateParticipants,
  type Group,
  type GroupPage,
  type ParticipantAction,
} from "@/server/whatsapp/uazapi-groups";

/**
 * Gestão de grupos.
 *
 * Tudo aqui fala direto com a uazapi, sem espelho no banco: a fonte da verdade
 * é o WhatsApp, e um cache local só criaria divergência — alguém entra ou sai
 * pelo celular e a tela passaria a mentir.
 */

export type GroupResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function credentials() {
  const ctx = await requireSession();
  requireRole(ctx, "staff");
  const connection = await getConnectionRow(ctx.organizationId);
  if (!connection) throw new Error("SEM_CONEXAO");
  return credentialsOf(connection);
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return "Não foi possível concluir.";
  if (error.message === "SEM_CONEXAO") return "Conecte o WhatsApp antes de gerenciar grupos.";
  if (error.message === "FORBIDDEN") return "Você não tem permissão para isso.";
  if (error.message.includes("401")) return "A instância recusou o token. Verifique a conexão.";
  if (error.message.includes("403")) return "O WhatsApp recusou: normalmente é falta de permissão de administrador no grupo.";
  if (error.message.includes("404")) return "Grupo não encontrado.";
  return error.message;
}

const listSchema = z.object({
  search: z.string().trim().max(80).optional(),
  offset: z.number().int().min(0).max(10_000).default(0),
  limit: z.number().int().min(1).max(60).default(30),
});

export async function listGroupsAction(input: unknown): Promise<GroupResult<GroupPage>> {
  try {
    const data = listSchema.parse(input ?? {});
    const page = await listGroups(await credentials(), {
      search: data.search,
      offset: data.offset,
      limit: data.limit,
      // Sem participantes na lista: com centenas de grupos, a carga é o que
      // decide se a tela abre em um segundo ou em vinte.
      withParticipants: false,
    });
    return { ok: true, data: page };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

const jidSchema = z.string().trim().min(5).endsWith("@g.us");

export async function getGroupAction(groupJid: unknown): Promise<GroupResult<Group>> {
  try {
    const jid = jidSchema.parse(groupJid);
    const ctx = await requireSession();
    const group = await getGroup(await credentials(), jid, { inviteLink: true, pendingRequests: true });
    // A lista rápida não sabe o tamanho do grupo; aqui ele é conhecido.
    await rememberGroupSize(ctx, jid, group.participantCount);
    return { ok: true, data: group };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome ao grupo.").max(100),
  participants: z.array(z.string().trim()).min(1, "Escolha ao menos uma pessoa.").max(256),
});

export async function createGroupAction(input: unknown): Promise<GroupResult<Group>> {
  try {
    const data = createSchema.parse(input);
    const group = await createGroup(await credentials(), data.name, data.participants);
    return { ok: true, data: group };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

const participantsSchema = z.object({
  groupJid: jidSchema,
  action: z.enum(["add", "remove", "promote", "demote", "approve", "reject"]),
  participants: z.array(z.string().trim().min(3)).min(1).max(50),
});

export async function updateParticipantsAction(input: unknown): Promise<GroupResult<Group>> {
  try {
    const data = participantsSchema.parse(input);
    const creds = await credentials();
    await updateParticipants(creds, data.groupJid, data.action as ParticipantAction, data.participants);
    // Relê do WhatsApp: só assim a tela reflete quem de fato entrou ou saiu —
    // o pedido pode ser recusado por privacidade sem virar erro.
    const group = await getGroup(creds, data.groupJid, { inviteLink: true, pendingRequests: true });
    return { ok: true, data: group };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

const settingsSchema = z.object({
  groupJid: jidSchema,
  name: z.string().trim().max(100).optional(),
  description: z.string().trim().max(2000).optional(),
  onlyAdminsSend: z.boolean().optional(),
  onlyAdminsEdit: z.boolean().optional(),
  requiresApproval: z.boolean().optional(),
});

export async function updateGroupAction(input: unknown): Promise<GroupResult<Group>> {
  try {
    const data = settingsSchema.parse(input);
    const creds = await credentials();

    if (data.name !== undefined) await updateGroupName(creds, data.groupJid, data.name);
    if (data.description !== undefined) await updateGroupDescription(creds, data.groupJid, data.description);
    if (data.onlyAdminsSend !== undefined) await setOnlyAdminsSend(creds, data.groupJid, data.onlyAdminsSend);
    if (data.onlyAdminsEdit !== undefined) await setOnlyAdminsEdit(creds, data.groupJid, data.onlyAdminsEdit);
    if (data.requiresApproval !== undefined) await setJoinApproval(creds, data.groupJid, data.requiresApproval);

    const group = await getGroup(creds, data.groupJid, { inviteLink: true });
    return { ok: true, data: group };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

export async function leaveGroupAction(groupJid: unknown): Promise<GroupResult<true>> {
  try {
    const jid = jidSchema.parse(groupJid);
    await leaveGroup(await credentials(), jid);
    return { ok: true, data: true };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

export async function resetInviteAction(groupJid: unknown): Promise<GroupResult<string | null>> {
  try {
    const jid = jidSchema.parse(groupJid);
    const creds = await credentials();
    const link = await resetInviteCode(creds, jid);
    if (link) return { ok: true, data: link };
    // Nem toda versão devolve o link novo; buscar de novo é mais confiável do
    // que mostrar vazio para quem acabou de gerar.
    const group = await getGroup(creds, jid, { inviteLink: true });
    return { ok: true, data: group.inviteLink ?? null };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

const joinSchema = z.string().trim().min(4).max(200);

export async function joinGroupAction(inviteCode: unknown): Promise<GroupResult<Group>> {
  try {
    const code = joinSchema.parse(inviteCode);
    const group = await joinGroup(await credentials(), code);
    return { ok: true, data: group };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

// ── Caixa de entrada de grupos ────────────────────────────────────────────

const inboxSchema = z.object({
  search: z.string().trim().max(80).optional(),
  classification: z.enum(["all", "none", "radar", "opportunity", "private"]).default("all"),
  offset: z.number().int().min(0).max(10_000).default(0),
  limit: z.number().int().min(1).max(60).default(30),
});

export async function listGroupInboxAction(input: unknown): Promise<GroupResult<GroupInboxPage>> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "staff");
    const data = inboxSchema.parse(input ?? {});
    const page = await listGroupInbox(ctx, data);
    return { ok: true, data: page };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

const classifySchema = z.object({
  jid: z.string().trim().endsWith("@g.us"),
  classification: z.enum(["none", "radar", "opportunity", "private"]),
});

/** Classificar é decisão da clínica: nunca é sobrescrita pela sincronia. */
export async function classifyGroupAction(input: unknown): Promise<GroupResult<true>> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "staff");
    const data = classifySchema.parse(input);
    await classifyGroup(ctx, data.jid, data.classification);
    revalidatePath("/grupos");
    return { ok: true, data: true };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

export async function pinGroupAction(input: unknown): Promise<GroupResult<true>> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "staff");
    const data = z.object({ jid: z.string().trim().endsWith("@g.us"), pinned: z.boolean() }).parse(input);
    await toggleGroupPinned(ctx, data.jid, data.pinned);
    revalidatePath("/grupos");
    return { ok: true, data: true };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

export type GroupThread = {
  conversationId: number | null;
  messages: Array<{
    id: number;
    body: string;
    senderName: string | null;
    direction: "inbound" | "outbound";
    messageType: string;
    mediaUrl: string | null;
    audioTranscription: string | null;
    createdAt: string;
  }>;
};

export async function groupThreadAction(jid: unknown): Promise<GroupResult<GroupThread>> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "staff");
    const alvo = jidSchema.parse(jid);
    const thread = await getGroupThread(ctx, alvo);
    return {
      ok: true,
      data: {
        conversationId: thread.conversationId,
        messages: thread.messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
      },
    };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

const sendSchema = z
  .object({
    jid: z.string().trim().endsWith("@g.us"),
    body: z.string().trim().max(4000).default(""),
    media: z
      .object({
        kind: z.enum(["image", "video", "document", "ptt"]),
        dataUrl: z.string().startsWith("data:").max(16_000_000),
        fileName: z.string().trim().max(200).optional(),
      })
      .nullable()
      .default(null),
  })
  .refine((value) => Boolean(value.body || value.media), { message: "Escreva uma mensagem ou escolha um arquivo." });

/** Enviar no grupo passa pelo mesmo caminho de qualquer envio do sistema. */
export async function sendToGroupAction(input: unknown): Promise<GroupResult<true>> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "staff");
    const data = sendSchema.parse(input);

    const { conversationId } = await getGroupThread(ctx, data.jid);
    if (!conversationId) return { ok: false, error: "Não foi possível abrir a conversa deste grupo." };

    let media: { type: "image" | "video" | "document" | "ptt"; url: string; fileName?: string; mimeType?: string } | undefined;
    if (data.media) {
      const [header, base64] = data.media.dataUrl.split(",", 2);
      if (!base64) return { ok: false, error: "Arquivo inválido." };
      const bytes = Math.floor((base64.length * 3) / 4);
      if (bytes > 10 * 1024 * 1024) return { ok: false, error: "Arquivo muito grande. O limite é 10 MB." };
      media = {
        type: data.media.kind,
        url: data.media.dataUrl,
        fileName: data.media.fileName,
        mimeType: header.match(/data:([^;]+)/)?.[1],
      };
    }

    const { sendFromInbox } = await import("@/server/services/whatsapp-message-service");
    await sendFromInbox(ctx, conversationId, data.body, { media });
    revalidatePath("/grupos");
    return { ok: true, data: true };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

/**
 * Resume o que foi dito no grupo nas últimas horas.
 *
 * Grupo movimentado tem centenas de mensagens por dia, e a pergunta de quem
 * abre é sempre a mesma: perdi alguma coisa importante? O resumo responde isso
 * sem obrigar a rolar tudo.
 */
export async function summarizeGroupAction(
  input: unknown,
): Promise<GroupResult<{ summary: string; messageCount: number }>> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "staff");
    const data = z
      .object({ jid: z.string().trim().endsWith("@g.us"), hours: z.number().int().min(1).max(168).default(48) })
      .parse(input);

    const thread = await getGroupThread(ctx, data.jid);
    const corte = Date.now() - data.hours * 3_600_000;
    const recentes = thread.messages.filter((m) => m.createdAt.getTime() >= corte);

    if (recentes.length === 0) {
      return { ok: false, error: `Nada foi dito neste grupo nas últimas ${data.hours} horas.` };
    }

    const transcricao = recentes
      .map((m) => {
        const quem = m.direction === "outbound" ? "Nós" : (m.senderName ?? "Participante");
        const texto = m.audioTranscription || m.body || `[${m.messageType}]`;
        return `${quem}: ${texto}`;
      })
      .join("\n")
      .slice(0, 24_000);

    const { complete, DEFAULT_MODEL } = await import("@/server/ai/llm");
    const turno = await complete({
      model: DEFAULT_MODEL,
      system:
        "Você resume conversas de grupos de WhatsApp de um negócio de estética. Responda em português do Brasil, " +
        "em no máximo seis linhas: o que foi combinado, o que ficou pendente e o que exige resposta nossa. " +
        "Se alguém pediu algo e não foi respondido, diga isso primeiro. Não invente nada que não esteja no texto.",
      messages: [{ role: "user", content: transcricao }],
      tools: [],
      maxOutputTokens: 500,
      temperature: 30,
    });

    const summary = turno.text.trim();
    if (!summary) return { ok: false, error: "O modelo não devolveu resumo." };

    const { db } = await import("@/db");
    const { whatsappGroups } = await import("@/db/schema");
    const { and: e, eq: igual } = await import("drizzle-orm");
    await db
      .update(whatsappGroups)
      .set({ lastSummary: summary, lastSummaryAt: new Date() })
      .where(e(igual(whatsappGroups.organizationId, ctx.organizationId), igual(whatsappGroups.jid, data.jid)));

    return { ok: true, data: { summary, messageCount: recentes.length } };
  } catch (error) {
    console.error(error);
    const mensagem = error instanceof Error ? error.message : "Falha ao resumir.";
    return {
      ok: false,
      error: mensagem.includes("API_KEY")
        ? "Falta a chave do provedor de IA no servidor para gerar resumos."
        : mensagem,
    };
  }
}

// ── Mensagens programadas ─────────────────────────────────────────────────

const agendarSchema = z.object({
  jid: z.string().trim().endsWith("@g.us"),
  groupName: z.string().trim().max(120).optional(),
  body: z.string().trim().max(4000).default(""),
  mentionAll: z.boolean().default(false),
  /** Data e hora local, no formato do campo do navegador. */
  scheduledFor: z.string().min(10),
  media: z
    .object({
      kind: z.enum(["image", "video", "document", "ptt"]),
      dataUrl: z.string().startsWith("data:").max(8_000_000),
      fileName: z.string().trim().max(200).optional(),
    })
    .nullable()
    .default(null),
});

export async function scheduleGroupMessageAction(input: unknown): Promise<GroupResult<true>> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "staff");
    const data = agendarSchema.parse(input);

    const quando = new Date(data.scheduledFor);
    if (Number.isNaN(quando.getTime())) return { ok: false, error: "Data inválida." };

    await scheduleGroupMessage(ctx, {
      groupJid: data.jid,
      groupName: data.groupName ?? null,
      body: data.body,
      mentionAll: data.mentionAll,
      scheduledFor: quando,
      media: data.media,
    });
    revalidatePath("/grupos");
    return { ok: true, data: true };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

export type ScheduledView = {
  id: number;
  body: string;
  mediaKind: string | null;
  mediaFileName: string | null;
  hasMedia: boolean;
  mentionAll: boolean;
  scheduledFor: string;
  status: "pending" | "sent" | "failed" | "cancelled";
  sentAt: string | null;
  error: string | null;
};

export async function listScheduledAction(jid: unknown): Promise<GroupResult<ScheduledView[]>> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "staff");
    const alvo = jidSchema.parse(jid);
    const itens = await listScheduledForGroup(ctx, alvo);
    return {
      ok: true,
      data: itens.map((i) => ({
        id: i.id,
        body: i.body,
        mediaKind: i.mediaKind,
        mediaFileName: i.mediaFileName,
        hasMedia: i.hasMedia,
        mentionAll: i.mentionAll,
        scheduledFor: i.scheduledFor.toISOString(),
        status: i.status,
        sentAt: i.sentAt?.toISOString() ?? null,
        error: i.error,
      })),
    };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

export async function cancelScheduledAction(id: unknown): Promise<GroupResult<true>> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "staff");
    await cancelScheduled(ctx, z.number().int().positive().parse(id));
    revalidatePath("/grupos");
    return { ok: true, data: true };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}
