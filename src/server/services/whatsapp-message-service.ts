import "server-only";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages, whatsappConnections } from "@/db/schema";
import type { TenantContext } from "@/server/auth";
import { aconteceuEm } from "@/server/services/inbox-service";
import {
  normalizeUazapiWebhook,
  type NormalizedMessage,
  type WaMessageKind,
  type WaMessageStatus,
} from "@/server/whatsapp/normalizer";
import { credentialsOf, getConnectionRow } from "@/server/services/whatsapp-connection-service";
import { resolveConversation } from "@/server/services/conversation-resolver";
import { publishInboxEvent } from "@/server/services/inbox-events";
import { getRedis } from "@/server/queues/redis";
import type { Json } from "@/server/whatsapp/json";
import {
  deleteMessage,
  downloadMessageMedia,
  findChats,
  findMessages,
  markChatRead,
  reactToMessage,
  requestMessageHistory,
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
  isUpdated: boolean;
  isInbound: boolean;
};

export async function ingestMessage(
  connection: ConnectionRow,
  msg: NormalizedMessage,
  options: { historical?: boolean } = {},
): Promise<IngestResult> {
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
  /**
   * O provedor é a fonte da verdade do status.
   *
   * Antes o status era cravado na mão — `sent` para o que sai, `delivered`
   * para o que entra — e o campo `status` que a uazapi manda em toda mensagem
   * era jogado fora. Resultado: 627 mensagens de saída paradas em "enviada" no
   * banco enquanto a uazapi já dizia "Read". O valor cravado vira apenas o
   * piso, para quando o payload não disser nada.
   */
  const statusPiso: WaMessageStatus = msg.fromMe ? "sent" : "delivered";
  const status =
    msg.status && deveAvancarStatus(statusPiso, msg.status) ? msg.status : statusPiso;
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
      status,
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
    const [existing] = await db
      .select({
        id: messages.id,
        body: messages.body,
        messageType: messages.messageType,
        status: messages.status,
        mediaUrl: messages.mediaUrl,
        mediaMimeType: messages.mediaMimeType,
        mediaFileName: messages.mediaFileName,
        quotedExternalId: messages.quotedExternalId,
      })
      .from(messages)
      .where(and(eq(messages.organizationId, connection.organizationId), eq(messages.externalId, msg.externalId)))
      .limit(1);
    if (!existing) {
      return { conversationId, messageId: null, customerId, isNew: false, isUpdated: false, isInbound: !msg.fromMe };
    }
    const patch: Partial<typeof messages.$inferInsert> = {};
    if (existing.body !== body) patch.body = body;
    const messageType = msg.kind === "system" ? "system" : msg.kind;
    if (existing.messageType !== messageType) patch.messageType = messageType;
    if (msg.mediaUrl && existing.mediaUrl !== msg.mediaUrl) patch.mediaUrl = msg.mediaUrl;
    if (msg.mediaMimeType && existing.mediaMimeType !== msg.mediaMimeType) patch.mediaMimeType = msg.mediaMimeType;
    if (msg.mediaFileName && existing.mediaFileName !== msg.mediaFileName) patch.mediaFileName = msg.mediaFileName;
    if (msg.quotedExternalId && existing.quotedExternalId !== msg.quotedExternalId) {
      patch.quotedExternalId = msg.quotedExternalId;
    }
    /**
     * É aqui que as mensagens presas em "enviada" se curam sozinhas: a
     * reconciliação relê o /message/find, que devolve o status atual, e este
     * ramo é o único que roda para mensagem que já existe. O ranque impede o
     * caminho inverso — uma releitura antiga não pode transformar "lida" de
     * volta em "entregue".
     */
    if (msg.status && deveAvancarStatus(existing.status, msg.status)) patch.status = msg.status;
    const isUpdated = Object.keys(patch).length > 0;
    if (isUpdated) await db.update(messages).set(patch).where(eq(messages.id, existing.id));
    return {
      conversationId,
      messageId: existing.id,
      customerId,
      isNew: false,
      isUpdated,
      isInbound: !msg.fromMe,
    };
  }

  if (msg.fromMe) {
    await db
      .update(conversations)
      .set(
        options.historical
          ? {
              lastMessageAt: sql`greatest(coalesce(${conversations.lastMessageAt}, ${msg.sentAt}), ${msg.sentAt})`,
              lastOutboundAt: sql`greatest(coalesce(${conversations.lastOutboundAt}, ${msg.sentAt}), ${msg.sentAt})`,
            }
          : { lastMessageAt: msg.sentAt, lastOutboundAt: msg.sentAt },
      )
      .where(eq(conversations.id, conversationId));
  } else if (options.historical) {
    // Recuperar histórico não cria uma nova pendência nem reabre atendimento:
    // apenas completa a linha do tempo já existente.
    await db
      .update(conversations)
      .set({
        lastMessageAt: sql`greatest(coalesce(${conversations.lastMessageAt}, ${msg.sentAt}), ${msg.sentAt})`,
        lastInboundAt: sql`greatest(coalesce(${conversations.lastInboundAt}, ${msg.sentAt}), ${msg.sentAt})`,
      })
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

  return { conversationId, messageId: inserted[0].id, customerId, isNew: true, isUpdated: false, isInbound: !msg.fromMe };
}

/** Reconcilia o banco com o histórico já conhecido pela instância. */
export async function syncConversationHistory(
  organizationId: number,
  conversationId: number,
  maxMessages = 200,
  options: { includeGroups?: boolean } = {},
): Promise<number> {
  const [conversation] = await db
    .select({ remoteJid: conversations.remoteJid, isGroup: conversations.isGroup })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .limit(1);
  if (!conversation?.remoteJid) return 0;

  const connection = await getConnectionRow(organizationId);
  if (!connection || connection.status !== "connected") return 0;

  const { imported, conversationIds } = await importChatHistory(
    connection,
    conversation.remoteJid,
    conversation.isGroup,
    maxMessages,
    options.includeGroups ?? false,
  );

  /**
   * O /message/find lê o acervo da uazapi; o history-sync é o que ALIMENTA
   * esse acervo com o que só existe no celular. O par funciona em duas etapas:
   * o pedido daqui volta vazio, e o bloco recuperado aparece na próxima
   * abertura da conversa, quando o /message/find já o encontra.
   *
   * Uma vez por hora por conversa: o pedido acorda o aparelho, e insistir não
   * traz o histórico mais rápido.
   */
  await maybeRequestOlderHistory(connection, conversation.remoteJid, organizationId, conversationId);

  if (conversationIds.size > 0) await publishInboxEvent(organizationId, { type: "message", conversationId });
  return imported;
}

const localHistoryRequests = new Map<string, number>();

async function maybeRequestOlderHistory(
  connection: ConnectionRow,
  remoteJid: string,
  organizationId: number,
  conversationId: number,
): Promise<void> {
  const key = `${connection.id}:${remoteJid}`;
  const redis = getRedis();
  if (redis) {
    const claimed = await redis.set(`whatsapp:history-request:${key}`, "1", "EX", 3600, "NX").catch(() => null);
    if (claimed !== "OK") return;
  } else {
    const last = localHistoryRequests.get(key) ?? 0;
    if (Date.now() - last < 3_600_000) return;
    localHistoryRequests.set(key, Date.now());
  }
  // A âncora é a mensagem mais antiga que já temos: o pedido busca o bloco
  // ANTERIOR a ela. Sem isso a uazapi ancorava no acervo dela — e em conversa
  // que ela nunca viu não havia âncora nenhuma.
  const [maisAntiga] = await db
    .select({ externalId: messages.externalId })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, organizationId),
        eq(messages.conversationId, conversationId),
        isNotNull(messages.externalId),
      ),
    )
    // A mais antiga pelo que ACONTECEU. Por `created_at`, a primeira linha
    // gravada de uma conversa já importada é justamente uma mensagem recente
    // trazida na importação — e a âncora sairia do ponto errado, pedindo ao
    // provedor um histórico que já temos.
    .orderBy(asc(aconteceuEm), asc(messages.id))
    .limit(1);

  await requestMessageHistory(credentialsOf(connection), remoteJid, 100, maisAntiga?.externalId).catch((error) => {
    console.warn("[whatsapp] histórico antigo não solicitado:", error instanceof Error ? error.message : error);
  });
}

/**
 * Importa um chat de forma idempotente. O mesmo caminho atende a recuperação
 * do Inbox e dos grupos, sem disparar agente de IA para mensagens históricas.
 */
async function importChatHistory(
  connection: ConnectionRow,
  remoteJid: string,
  expectedGroup: boolean,
  maxMessages: number,
  includeGroups: boolean,
): Promise<{ imported: number; conversationIds: Set<number> }> {
  let imported = 0;
  const conversationIds = new Set<number>();
  const allRows: Json[] = [];
  for (let offset = 0; offset < maxMessages; offset += 100) {
    const rows = await findMessages(credentialsOf(connection), {
      chatid: remoteJid,
      limit: Math.min(100, maxMessages - offset),
      offset,
    });
    allRows.push(...rows);
    if (rows.length < 100) break;
  }
  // /message/find vem do mais novo para o mais antigo, inclusive entre
  // páginas. Ingerir o lote inteiro ao contrário mantém a cronologia correta.
  for (const raw of allRows.reverse()) {
    const normalized = normalizeUazapiWebhook({ EventType: "messages", event: raw });
    if (normalized.kind !== "message") continue;
    if (normalized.message.isGroup !== expectedGroup) continue;
    if (normalized.message.isGroup && !includeGroups) continue;
    const result = await ingestMessage(connection, normalized.message, { historical: true });
    if (result.isNew) {
      imported += 1;
      conversationIds.add(result.conversationId);
    } else if (result.isUpdated) {
      conversationIds.add(result.conversationId);
    }
  }
  return { imported, conversationIds };
}

/**
 * Rede de segurança do Inbox para mensagens enviadas ou recebidas no celular.
 * O webhook continua sendo o caminho instantâneo; a cada ciclo comparamos os
 * chats recentes da instância e só consultamos mensagens dos que avançaram.
 */
export async function syncRecentConversationHistory(organizationId: number, maxChats = 20): Promise<number> {
  const connection = await getConnectionRow(organizationId);
  if (!connection || connection.status !== "connected") return 0;

  const redis = getRedis();
  if (redis) {
    const claimed = await redis
      .set(`inbox:recent-sync:${organizationId}`, "1", "EX", 20, "NX")
      .catch(() => null);
    if (claimed !== "OK") return 0;
  }

  const recent = await findChats(credentialsOf(connection), { limit: maxChats, isGroup: false });
  const jids = recent.map((chat) => chat.jid);
  if (jids.length === 0) return 0;

  const local = await db
    .select({ remoteJid: conversations.remoteJid, lastMessageAt: conversations.lastMessageAt })
    .from(conversations)
    .where(and(eq(conversations.organizationId, organizationId), inArray(conversations.remoteJid, jids)));
  const localByJid = new Map(local.map((row) => [row.remoteJid, row.lastMessageAt?.getTime() ?? 0]));

  let imported = 0;
  const touched = new Set<number>();
  for (const chat of recent) {
    if (chat.isGroup) continue;
    const rawTimestamp = chat.lastMessageTimestamp ?? 0;
    const providerMs = rawTimestamp > 1e12 ? rawTimestamp : rawTimestamp * 1000;
    const localMs = localByJid.get(chat.jid) ?? 0;
    // Chat já reconciliado não precisa de outra chamada /message/find.
    if (providerMs > 0 && localMs >= providerMs) continue;

    const result = await importChatHistory(connection, chat.jid, false, 100, false);
    imported += result.imported;
    for (const id of result.conversationIds) touched.add(id);
  }

  for (const conversationId of touched) {
    await publishInboxEvent(organizationId, { type: "message", conversationId });
  }
  return imported;
}

/**
 * A confirmação chegou antes da mensagem existir aqui.
 *
 * Não é erro de programação nem dado corrompido: a uazapi entrega o
 * `messages_update` de uma mensagem enviada pelo celular antes do `messages`
 * que a cria. Quem trata este erro é a rota do webhook, que responde 503 para
 * a uazapi reentregar — e na reentrega a linha já existe. Engolir isso em
 * silêncio (o `if (!row) return` de antes) apagava a confirmação PARA SEMPRE,
 * porque a deduplicação marcava o evento como processado com sucesso.
 */
export class MensagemAindaNaoGravadaError extends Error {
  constructor(readonly externalId: string) {
    super(`Mensagem ${externalId} ainda não foi gravada; reentregar o evento.`);
    this.name = "MensagemAindaNaoGravadaError";
  }
}

/**
 * Ranque do ciclo de vida de uma mensagem enviada.
 *
 * Único lugar onde a ordem é declarada: webhook de confirmação e reconciliação
 * pelo /message/find precisam concordar, senão um caminho desfaz o outro.
 */
const STATUS_RANK: Record<WaMessageStatus, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

/**
 * Status só avança: um "delivered" atrasado não pode apagar um "read".
 *
 * `failed` é a exceção e sempre vence — uma mensagem que o WhatsApp recusou
 * precisa aparecer como recusada mesmo que já tenha sido dada como entregue.
 */
export function deveAvancarStatus(atual: WaMessageStatus, proximo: WaMessageStatus): boolean {
  if (proximo === "failed") return atual !== "failed";
  return STATUS_RANK[proximo] > STATUS_RANK[atual];
}

export async function applyStatusUpdate(
  connection: ConnectionRow,
  externalId: string,
  status: WaMessageStatus,
): Promise<void> {
  const [row] = await db
    .select({ id: messages.id, status: messages.status })
    .from(messages)
    .where(and(eq(messages.organizationId, connection.organizationId), eq(messages.externalId, externalId)))
    .limit(1);
  if (!row) throw new MensagemAindaNaoGravadaError(externalId);
  if (!deveAvancarStatus(row.status, status)) return;
  await db.update(messages).set({ status }).where(eq(messages.id, row.id));
}

export type SendOptions = {
  /** Autor humano. Ausente significa envio do agente. */
  senderUserId?: number | null;
  sender: "user" | "ai" | "system";
  media?: { type: MediaKind; url: string; fileName?: string; mimeType?: string };
  /** Id externo da mensagem que está sendo respondida. */
  replyToExternalId?: string;
  /**
   * Atraso antes de a mensagem sair, executado pela uazapi — que mostra
   * "Digitando..." para o cliente durante a espera. Só vale para texto: em
   * mídia o cliente já vê "enviando arquivo".
   */
  delayMs?: number;
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
  // Só a resposta escrita por uma pessoa marca a conversa como lida no
  // aparelho. Lembrete e resposta do agente saem sem ler: se a cliente
  // escreveu algo que ninguém abriu ainda, esse "não lido" é justamente o que
  // faz alguém olhar.
  const respostaDeGente = options.sender === "user";
  const result = options.media
    ? await sendMedia(credentials, conversation.remoteJid, {
        type: options.media.type,
        file: options.media.url,
        caption: body || undefined,
        fileName: options.media.fileName,
        mimetype: options.media.mimeType,
        replyId: options.replyToExternalId,
        markRead: respostaDeGente,
      })
    : await sendText(credentials, conversation.remoteJid, body, {
        replyId: options.replyToExternalId,
        delayMs: options.delayMs,
        markRead: respostaDeGente,
      });

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
  // Mesma corrida do status: a reação pode chegar antes da mensagem reagida.
  if (!row) throw new MensagemAindaNaoGravadaError(targetExternalId);

  const atuais = Array.isArray(row.reactions) ? (row.reactions as Reaction[]) : [];
  const semAntiga = atuais.filter((r) => r.fromMe !== fromMe);
  const proximas = emoji ? [...semAntiga, { emoji, fromMe, at: new Date().toISOString() }] : semAntiga;

  await db.update(messages).set({ reactions: proximas }).where(eq(messages.id, row.id));
}

/**
 * Guarda a URL da mídia que a uazapi acabou de baixar.
 *
 * A URL que vem no evento de mensagem é a do WhatsApp, criptografada: só abre
 * com a chave da mensagem. Quando a uazapi termina de baixar o arquivo, ela
 * avisa com uma URL própria, essa sim exibível — e o aviso só chega uma vez.
 * Devolve as conversas afetadas para que só elas sejam avisadas na tela.
 */
export async function applyMediaDownloaded(
  connection: ConnectionRow,
  externalIds: string[],
  mediaUrl: string,
  mediaMimeType: string | null,
): Promise<number[]> {
  if (externalIds.length === 0) return [];
  const atualizadas = await db
    .update(messages)
    .set({
      mediaUrl,
      // O mime só é sobrescrito quando ainda não temos um: o do evento é o do
      // arquivo baixado e às vezes vem mais genérico que o original.
      ...(mediaMimeType ? { mediaMimeType: sql`coalesce(${messages.mediaMimeType}, ${mediaMimeType})` } : {}),
    })
    .where(
      and(
        eq(messages.organizationId, connection.organizationId),
        inArray(messages.externalId, externalIds),
      ),
    )
    .returning({ conversationId: messages.conversationId, externalId: messages.externalId });
  /**
   * Mesma corrida do status: o download pode terminar antes de a mensagem ser
   * gravada. Reentregar é o que preserva a URL.
   *
   * A cobrança é por id, não pelo lote: um evento pode citar várias mensagens
   * (álbum), e exigir só que ALGUMA tenha casado deixava as demais sem URL para
   * sempre — o aviso de download chega uma vez só, e a URL do WhatsApp que
   * ficou na linha vem criptografada, ou seja, não abre. Reaplicar o que já
   * casou na reentrega é inofensivo: a gravação é a mesma.
   */
  const gravadas = new Set(atualizadas.map((linha) => linha.externalId));
  const faltando = externalIds.filter((id) => !gravadas.has(id));
  if (faltando.length > 0) throw new MensagemAindaNaoGravadaError(faltando.join(","));
  return [...new Set(atualizadas.map((linha) => linha.conversationId))];
}

/** Marca como apagada, sem remover a linha: o histórico não pode ganhar buracos. */
export async function markMessageDeleted(connection: ConnectionRow, externalId: string): Promise<void> {
  const marcadas = await db
    .update(messages)
    .set({ deletedAt: new Date() })
    .where(and(eq(messages.organizationId, connection.organizationId), eq(messages.externalId, externalId)))
    .returning({ id: messages.id });
  // Apagar antes de a mensagem ter sido gravada deixaria a linha visível para
  // sempre: a reentrega é a única chance de marcá-la.
  if (marcadas.length === 0) throw new MensagemAindaNaoGravadaError(externalId);
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
