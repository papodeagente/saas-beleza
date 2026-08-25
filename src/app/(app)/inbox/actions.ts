"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { conversations, organizationMembers } from "@/db/schema";
import { requireRole, requireSession } from "@/server/auth";
import { markConversationReadOnWhatsapp } from "@/server/services/whatsapp-read-receipts";
import { clearUnread } from "@/server/services/conversation-resolver";
import { publishInboxEvent } from "@/server/services/inbox-events";
import {
  type ConversationDetail,
  type InboxTab,
  LIMITE_DA_LISTA,
  clearProviderUnread,
  countByTab,
  getConversation,
  listConversations,
} from "@/server/services/inbox-service";
import { syncProfilePictures } from "@/server/services/profile-picture-service";
import {
  deleteFromInbox,
  notifyPresence,
  fetchMediaUrl,
  reactFromInbox,
  sendFromInbox,
  syncConversationHistory,
  syncRecentConversationHistory,
  transcribeAudio,
} from "@/server/services/whatsapp-message-service";

/**
 * Traduz a exceção para uma frase que a atendente consegue usar.
 *
 * Devolver `error.message` cru punha três coisas na cara dela: o JSON dos
 * issues do Zod, a palavra "NEXT_REDIRECT" (que é o throw de controle do Next
 * quando a assinatura vence) e "FORBIDDEN". Nenhuma delas diz o que fazer.
 *
 * O redirect é RE-LANÇADO de propósito: engoli-lo transforma "sua assinatura
 * venceu, veja os planos" num toast vermelho sem saída.
 */
function mensagemDeErro(error: unknown, padrao: string): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
  ) {
    throw error;
  }
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? padrao;
  if (error instanceof Error && error.message === "FORBIDDEN") {
    return "Seu acesso não permite esta ação. Fale com a gestão.";
  }
  if (error instanceof Error && error.message === "UNAUTHENTICATED") {
    return "Sua sessão expirou. Entre de novo.";
  }
  if (error instanceof Error && error.message.includes("conexão")) {
    return "Conecte o WhatsApp em Configurações antes de responder.";
  }
  console.error(error);
  return padrao;
}

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
  photoUrl: string | null;
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
    email: string | null;
    visitsCount: number;
    noShowCount: number;
    totalSpentCents: number;
    lastVisitAt: string | null;
    stage: "novo" | "ativo" | "recorrente" | "sumido";
    tags: string[];
    appointmentsCount: number;
    nextAppointments: Array<{
      id: number;
      startsAt: string;
      serviceName: string;
      professionalName: string;
      status: string;
    }>;
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
    photoUrl: detail.conversation.photoUrl,
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
          nextAppointments: detail.context.nextAppointments.map((a) => ({
            ...a,
            startsAt: a.startsAt.toISOString(),
          })),
        }
      : null,
  };
}

const idSchema = z.number().int().positive();

export async function syncConversationHistoryAction(input: unknown): Promise<{ ok: boolean; imported: number }> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "staff");
    const conversationId = idSchema.parse(input);
    const imported = await syncConversationHistory(ctx.organizationId, conversationId);
    return { ok: true, imported };
  } catch (error) {
    console.warn("[inbox] reconciliação de histórico falhou:", error instanceof Error ? error.message : error);
    return { ok: false, imported: 0 };
  }
}

/** Recupera chats recentes que avançaram no aparelho, mesmo se o webhook oscilou. */
export async function syncRecentInboxAction(): Promise<{ ok: boolean; imported: number }> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "staff");
    const imported = await syncRecentConversationHistory(ctx.organizationId);
    return { ok: true, imported };
  } catch (error) {
    console.warn("[inbox] reconciliação dos chats recentes falhou:", error instanceof Error ? error.message : error);
    return { ok: false, imported: 0 };
  }
}

/**
 * Carrega uma conversa isolada e zera o não lido.
 *
 * É o que permite trocar de conversa sem recarregar a rota: a lista já está na
 * tela, só as mensagens e o contexto viajam.
 */
export async function loadConversationAction(
  input: unknown,
  options: { markRead?: boolean } = {},
): Promise<InboxDetail | null> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "staff");
    const conversationId = idSchema.parse(input);
    // A leitura periódica passa `markRead: false`. Zerar o não lido a cada
    // varredura escrevia à toa e destruía a fronteira de onde a atendente
    // parou de ler. A escrita roda em PARALELO com a leitura: são
    // independentes, e em série ela adiava a pintura da conversa em uma
    // viagem inteira ao banco.
    const [detail] = await Promise.all([
      getConversation(ctx, conversationId),
      options.markRead !== false ? clearUnread(ctx.organizationId, conversationId) : null,
      // O crachá da lista é o maior entre o nosso não lido e o do aparelho;
      // sem zerar os dois, abrir a conversa apagava só metade do número.
      options.markRead !== false ? clearProviderUnread(ctx.organizationId, conversationId) : null,
    ]);
    if (!detail) return null;

    // Confirmação de leitura no WhatsApp da cliente (os dois tiques azuis).
    // Fora do `await`: é uma viagem à rede externa e não pode entrar no
    // caminho que pinta a conversa — foi exatamente esse tipo de chamada em
    // série que deixou a troca de tela em 1,3s. Falhar aqui não é erro de
    // leitura, então o resultado é descartado de propósito.
    if (options.markRead !== false) {
      void markConversationReadOnWhatsapp(ctx.organizationId, conversationId);
    }

    return serialize(detail);
  } catch (error) {
    console.error(error);
    return null;
  }
}

/**
 * Recarrega a lista sem sair da rota — usado pela troca de aba, pela busca e
 * pela leitura periódica.
 *
 * Devolve os contadores junto porque eles congelavam: a tela só os recebia no
 * carregamento da página, então "Fila 3" continuava 3 enquanto chegavam mais
 * dez. A contagem é uma consulta só, medida em 0,37 ms com 22 mil conversas.
 *
 * O try/catch não é zelo: esta é a única action chamada de dentro de um
 * callback de intervalo. Uma rejeição ali vira erro não tratado e o inbox para
 * de atualizar em silêncio; no caminho da troca de aba, derruba a tela inteira.
 */
export type InboxListResult =
  | {
      ok: true;
      /**
       * "abertas" = TODAS as conversas abertas, sem filtro de aba: Meus, Fila e
       * Todos são fatias deste mesmo conjunto e o cliente as recorta sozinho,
       * sem voltar ao servidor. "aba" = a lista já veio recortada, porque a
       * pergunta não cabia no retrato (busca, Finalizadas, ou caixa grande
       * demais para o teto de linhas).
       */
      escopo: "abertas" | "aba";
      rows: SerializedConversation[];
      counts: Awaited<ReturnType<typeof countByTab>>;
    }
  | { ok: false; error: string };

type SerializedConversation = Omit<
  Awaited<ReturnType<typeof listConversations>>[number],
  "lastMessageAt" | "providerLastAt" | "lastActivityAt"
> & { lastMessageAt: string | null; providerLastAt: string | null; lastActivityAt: string | null };

function serializeRow(row: Awaited<ReturnType<typeof listConversations>>[number]): SerializedConversation {
  return {
    ...row,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    providerLastAt: row.providerLastAt?.toISOString() ?? null,
    lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
  };
}

const listSchema = z.object({
  tab: z.enum(["meus", "fila", "todos", "resolvidas"]),
  search: z.string().trim().max(100).optional(),
  assignee: z.union([z.literal("all"), z.literal("unassigned"), idSchema]).optional(),
});

/**
 * Uma consulta serve as três abas de conversa aberta.
 *
 * Meus, Fila e Todos são o MESMO conjunto — conversas abertas — recortado por
 * quem é o dono. Perguntar de novo ao servidor a cada clique de aba é pagar
 * uma viagem inteira para receber um subconjunto do que já estava na tela.
 * Aqui o servidor devolve as abertas uma vez e o cliente recorta.
 *
 * Duas perguntas continuam sendo do servidor, porque não cabem no retrato:
 * a busca (procura em toda a caixa, não nas 100 linhas carregadas) e
 * "Finalizadas" (status diferente, conjunto disjunto). E uma terceira, rara:
 * caixa com mais conversas abertas do que o teto de linhas — aí o retrato
 * seria parcial e um recorte no cliente MENTIRIA sobre quantas há em cada aba,
 * então cada aba volta a perguntar.
 */
export async function listConversationsAction(input: {
  tab: InboxTab;
  search?: string;
  assignee?: "all" | "unassigned" | number;
}): Promise<InboxListResult> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "staff");
    const data = listSchema.parse(input);
    const daAba = Boolean(data.search) || data.tab === "resolvidas";

    const [rows, counts] = await Promise.all([
      listConversations(ctx, daAba ? data : { tab: "todos" }),
      countByTab(ctx),
    ]);

    if (!daAba && counts.todos > LIMITE_DA_LISTA) {
      const recortadas = await listConversations(ctx, data);
      return { ok: true, escopo: "aba", rows: recortadas.map(serializeRow), counts };
    }

    return { ok: true, escopo: daAba ? "aba" : "abertas", rows: rows.map(serializeRow), counts };
  } catch (error) {
    return { ok: false, error: mensagemDeErro(error, "Não foi possível atualizar a lista.") };
  }
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
    requireRole(ctx, "staff");
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
    return { ok: false, error: mensagemDeErro(error, "Não foi possível enviar a mensagem.") };
  }
}

const assignSchema = z.object({
  conversationId: idSchema,
  action: z.enum(["assumir", "transferir", "devolver", "resolver", "reabrir"]),
  targetUserId: idSchema.optional(),
}).superRefine((data, ctx) => {
  if (data.action === "transferir" && data.targetUserId == null) {
    ctx.addIssue({ code: "custom", message: "Escolha para quem deseja transferir." });
  }
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
    requireRole(ctx, "staff");
    const data = assignSchema.parse(input);

    const [conversation] = await db
      .select({ assignedUserId: conversations.assignedUserId, lastAssignedUserId: conversations.lastAssignedUserId })
      .from(conversations)
      .where(and(eq(conversations.id, data.conversationId), eq(conversations.organizationId, ctx.organizationId)))
      .limit(1);
    if (!conversation) return { ok: false, error: "Conversa não encontrada." };

    if (data.action === "transferir") {
      const [target] = await db
        .select({ userId: organizationMembers.userId })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, ctx.organizationId),
            eq(organizationMembers.userId, data.targetUserId!),
            inArray(organizationMembers.role, ["owner", "admin", "staff"]),
          ),
        )
        .limit(1);
      if (!target) return { ok: false, error: "Esse atendente não pertence à sua equipe." };
    }

    const previousOwner = conversation.assignedUserId ?? conversation.lastAssignedUserId;

    const patch =
      data.action === "assumir"
        ? {
            assignedUserId: ctx.userId,
            assignedAt: new Date(),
            status: "open" as const,
            resolvedAt: null,
            resolvedByUserId: null,
            controlledBy: "human" as const,
            lastAssignedUserId:
              conversation.assignedUserId && conversation.assignedUserId !== ctx.userId
                ? conversation.assignedUserId
                : conversation.lastAssignedUserId,
          }
        : data.action === "transferir"
          ? {
              assignedUserId: data.targetUserId!,
              assignedAt: new Date(),
              status: "open" as const,
              resolvedAt: null,
              resolvedByUserId: null,
              controlledBy: "human" as const,
              lastAssignedUserId:
                conversation.assignedUserId && conversation.assignedUserId !== data.targetUserId
                  ? conversation.assignedUserId
                  : conversation.lastAssignedUserId,
            }
        : data.action === "devolver"
          ? { assignedUserId: null, lastAssignedUserId: previousOwner ?? ctx.userId, assignedAt: null }
          : data.action === "resolver"
            ? { status: "closed" as const, resolvedAt: new Date(), resolvedByUserId: ctx.userId, lastAssignedUserId: previousOwner ?? ctx.userId, assignedUserId: null }
            : { status: "open" as const, resolvedAt: null, resolvedByUserId: null, assignedUserId: ctx.userId };

    const result = await db
      .update(conversations)
      .set(patch)
      .where(and(eq(conversations.id, data.conversationId), eq(conversations.organizationId, ctx.organizationId)))
      .returning({ id: conversations.id });
    if (result.length === 0) return { ok: false, error: "Conversa não encontrada." };

    await publishInboxEvent(ctx.organizationId, { type: "assignment", conversationId: data.conversationId });
    revalidatePath("/inbox");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: mensagemDeErro(error, "Não foi possível atualizar a conversa.") };
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
    requireRole(ctx, "staff");
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
    requireRole(ctx, "staff");
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
    return { ok: false, error: mensagemDeErro(error, "Não foi possível enviar o arquivo.") };
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
    requireRole(ctx, "staff");
    const data = reactSchema.parse(input);
    await reactFromInbox(ctx.organizationId, data.conversationId, data.messageId, data.emoji);
    revalidatePath("/inbox");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: mensagemDeErro(error, "Não foi possível reagir.") };
  }
}

const messageSchema = z.object({ conversationId: idSchema, messageId: idSchema });

/** Apaga para todos. Não há desfazer. */
export async function deleteMessageAction(input: unknown): Promise<InboxResult> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "staff");
    const data = messageSchema.parse(input);
    await deleteFromInbox(ctx.organizationId, data.conversationId, data.messageId);
    revalidatePath("/inbox");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: mensagemDeErro(error, "Não foi possível apagar.") };
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
    requireRole(ctx, "staff");
    const data = messageSchema.parse(input);
    const url = await fetchMediaUrl(ctx.organizationId, data.conversationId, data.messageId);
    revalidatePath("/inbox");
    return { ok: true, url };
  } catch (error) {
    return { ok: false, error: mensagemDeErro(error, "Não foi possível carregar a mídia.") };
  }
}

export async function transcribeAction(
  input: unknown,
): Promise<{ ok: true; text: string | null } | { ok: false; error: string }> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "staff");
    const data = messageSchema.parse(input);
    const text = await transcribeAudio(ctx.organizationId, data.conversationId, data.messageId);
    revalidatePath("/inbox");
    return { ok: true, text };
  } catch (error) {
    return { ok: false, error: mensagemDeErro(error, "Não foi possível transcrever.") };
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
    requireRole(ctx, "staff");
    const data = presenceSchema.parse(input);
    await notifyPresence(ctx.organizationId, data.conversationId, data.presence);
  } catch {
    /* silencioso de propósito */
  }
}

// ---------------------------------------------------------------------------
// Fotos de perfil
// ---------------------------------------------------------------------------

export type SyncPhotosResult =
  | { ok: true; mensagem: string }
  | { ok: false; error: string };

/**
 * Busca no WhatsApp as fotos que ainda faltam.
 *
 * É uma ação explícita, e não algo que roda sozinho ao abrir o inbox, por dois
 * motivos: cada foto é uma chamada a um serviço de terceiro compartilhado por
 * toda a clínica, e a atendente precisa saber que a demora tem uma causa. O
 * serviço já respeita um intervalo entre buscas e só procura o que está
 * faltando ou vencido, então clicar duas vezes seguidas não repete o trabalho.
 */
export async function syncPhotosAction(): Promise<SyncPhotosResult> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "staff");
    const r = await syncProfilePictures(ctx);

    if (r.buscadas === 0) return { ok: true, mensagem: "As fotos já estão atualizadas." };

    const partes: string[] = [];
    if (r.atualizadas > 0) {
      partes.push(`${r.atualizadas} ${r.atualizadas === 1 ? "foto encontrada" : "fotos encontradas"}`);
    }
    // Contato sem foto não é falha: é privacidade, e dizer isso evita a
    // impressão de que o botão não funcionou.
    if (r.semFoto > 0) {
      partes.push(`${r.semFoto} sem foto no WhatsApp`);
    }
    if (r.falhas > 0) {
      partes.push(`${r.falhas} não ${r.falhas === 1 ? "respondeu" : "responderam"}`);
    }

    // Dizer quanto falta é o que transforma um botão que "parece não ter feito
    // nada" num processo com fim à vista. Numa conta com centenas de grupos,
    // uma rodada só não dá conta e o silêncio pareceria defeito.
    const cauda =
      r.restantes > 0
        ? `. Faltam ${r.restantes} — toque de novo para continuar.`
        : ".";

    revalidatePath("/inbox");
    revalidatePath("/grupos");
    return { ok: true, mensagem: (partes.join(", ") || "Nada para atualizar") + cauda };
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return { ok: false, error: "Sessão expirada. Entre de novo." };
    }
    console.error(error);
    return { ok: false, error: "Não foi possível buscar as fotos agora." };
  }
}
