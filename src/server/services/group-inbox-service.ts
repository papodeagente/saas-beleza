import "server-only";
import { and, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages, whatsappGroups } from "@/db/schema";
import { whichHavePictures } from "@/server/services/profile-picture-service";
import type { TenantContext } from "@/server/auth";
import { credentialsOf, getConnectionRow } from "@/server/services/whatsapp-connection-service";
import { resolveConversation } from "@/server/services/conversation-resolver";
import { syncConversationHistory } from "@/server/services/whatsapp-message-service";
import { getRedis } from "@/server/queues/redis";
import { listGroups, type Group } from "@/server/whatsapp/uazapi-groups";

/**
 * Caixa de entrada de grupos.
 *
 * Três fontes se encontram aqui, e cada uma manda no que sabe: o WhatsApp diz
 * quais grupos existem e quem está dentro; o banco guarda o que a clínica
 * decidiu sobre cada um (classificação, fixado); e as conversas locais têm o
 * que foi dito. Nenhuma tenta ser dona do dado da outra — é o que evita a
 * lista mentir quando alguém entra ou sai pelo celular.
 */

export type GroupClassification = "none" | "radar" | "opportunity" | "private";

export type GroupInboxItem = {
  jid: string;
  name: string;
  description: string | null;
  participantCount: number;
  classification: GroupClassification;
  pinned: boolean;
  conversationId: number | null;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  lastMessageFromMe: boolean;
  unreadCount: number;
  /** Última palavra foi do grupo: alguém falou e ninguém respondeu. */
  awaitingReply: boolean;
  /** Foto do grupo guardada, ou nulo quando não há. */
  photoUrl: string | null;
};

export type GroupInboxPage = {
  items: GroupInboxItem[];
  total: number;
  counts: Record<GroupClassification | "all", number>;
};

/** Guarda o retrato do grupo para a próxima abertura já ter nome e tamanho. */
async function upsertGroupSnapshots(
  organizationId: number,
  connectionId: number,
  grupos: Group[],
): Promise<Map<string, { classification: GroupClassification; pinned: boolean; participantCount: number }>> {
  if (grupos.length === 0) return new Map();

  await db
    .insert(whatsappGroups)
    .values(
      grupos.map((g) => ({
        organizationId,
        connectionId,
        jid: g.jid,
        name: g.name,
        description: g.description,
        participantCount: g.participantCount,
        lastSyncedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: [whatsappGroups.organizationId, whatsappGroups.jid],
      set: {
        // A classificação é decisão da clínica e nunca é sobrescrita pela sincronia.
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        // A listagem rápida devolve zero participantes; nesse caso o número que
        // já estava guardado vale mais do que sobrescrever com zero.
        participantCount: sql`greatest(excluded.participant_count, ${whatsappGroups.participantCount})`,
        lastSyncedAt: sql`excluded.last_synced_at`,
        updatedAt: new Date(),
      },
    });

  const linhas = await db
    .select({
      jid: whatsappGroups.jid,
      classification: whatsappGroups.classification,
      pinned: whatsappGroups.pinned,
      participantCount: whatsappGroups.participantCount,
    })
    .from(whatsappGroups)
    .where(
      and(
        eq(whatsappGroups.organizationId, organizationId),
        inArray(
          whatsappGroups.jid,
          grupos.map((g) => g.jid),
        ),
      ),
    );

  return new Map(
    linhas.map((l) => [
      l.jid,
      { classification: l.classification, pinned: l.pinned, participantCount: l.participantCount },
    ]),
  );
}

export async function listGroupInbox(
  ctx: TenantContext,
  params: { search?: string; classification?: GroupClassification | "all"; limit?: number; offset?: number } = {},
): Promise<GroupInboxPage> {
  const connection = await getConnectionRow(ctx.organizationId);
  if (!connection) throw new Error("SEM_CONEXAO");

  const limit = params.limit ?? 30;
  const offset = params.offset ?? 0;
  const filtro = params.classification ?? "all";

  const pagina = await listGroups(credentialsOf(connection), {
    search: params.search,
    limit: filtro === "all" ? limit : 200,
    offset: filtro === "all" ? offset : 0,
    withParticipants: false,
  });

  const decisoes = await upsertGroupSnapshots(ctx.organizationId, connection.id, pagina.groups);

  // Conversas locais desses grupos, com a última mensagem de cada uma.
  const jids = pagina.groups.map((g) => g.jid);
  const conversasPorJid = new Map<
    string,
    { id: number; unreadCount: number; lastMessageAt: Date | null; preview: string | null; fromMe: boolean }
  >();

  if (jids.length > 0) {
    const ultima = db
      .select({
        conversationId: messages.conversationId,
        body: messages.body,
        direction: messages.direction,
        rank: sql<number>`row_number() over (partition by ${messages.conversationId} order by ${messages.createdAt} desc)`.as(
          "rank",
        ),
      })
      .from(messages)
      .where(eq(messages.organizationId, ctx.organizationId))
      .as("ultima");

    const linhas = await db
      .select({
        id: conversations.id,
        remoteJid: conversations.remoteJid,
        unreadCount: conversations.unreadCount,
        lastMessageAt: conversations.lastMessageAt,
        preview: ultima.body,
        direction: ultima.direction,
      })
      .from(conversations)
      .leftJoin(ultima, and(eq(ultima.conversationId, conversations.id), eq(ultima.rank, 1)))
      .where(
        and(
          eq(conversations.organizationId, ctx.organizationId),
          eq(conversations.isGroup, true),
          inArray(conversations.remoteJid, jids),
        ),
      );

    for (const linha of linhas) {
      if (!linha.remoteJid) continue;
      conversasPorJid.set(linha.remoteJid, {
        id: linha.id,
        unreadCount: linha.unreadCount,
        lastMessageAt: linha.lastMessageAt,
        preview: linha.preview,
        fromMe: linha.direction === "outbound",
      });
    }
  }

  // A foto entra só no fim, para a página visível — por isso a lista
  // intermediária ainda não a carrega.
  let items: Array<Omit<GroupInboxItem, "photoUrl">> = pagina.groups.map((grupo) => {
    const decisao = decisoes.get(grupo.jid);
    const conversa = conversasPorJid.get(grupo.jid);
    return {
      jid: grupo.jid,
      name: grupo.name,
      description: grupo.description,
      participantCount: Math.max(grupo.participantCount, decisao?.participantCount ?? 0),
      classification: decisao?.classification ?? "none",
      pinned: decisao?.pinned ?? false,
      conversationId: conversa?.id ?? null,
      lastMessageAt: conversa?.lastMessageAt ?? null,
      lastMessagePreview: conversa?.preview ?? null,
      lastMessageFromMe: conversa?.fromMe ?? false,
      unreadCount: conversa?.unreadCount ?? 0,
      awaitingReply: Boolean(conversa && !conversa.fromMe && conversa.lastMessageAt),
    };
  });

  if (filtro !== "all") {
    items = items.filter((item) => item.classification === filtro);
  }

  // Fixado primeiro, depois quem falou por último: a ordem em que a atenção
  // deve cair numa lista de centenas.
  items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const ta = a.lastMessageAt?.getTime() ?? 0;
    const tb = b.lastMessageAt?.getTime() ?? 0;
    return tb - ta;
  });

  const totalPorClasse = await db
    .select({
      classification: whatsappGroups.classification,
      total: sql<number>`count(*)::int`,
    })
    .from(whatsappGroups)
    .where(eq(whatsappGroups.organizationId, ctx.organizationId))
    .groupBy(whatsappGroups.classification);

  const counts: GroupInboxPage["counts"] = {
    all: pagina.total,
    none: 0,
    radar: 0,
    opportunity: 0,
    private: 0,
  };
  for (const linha of totalPorClasse) counts[linha.classification] = linha.total;

  const visiveis = filtro === "all" ? items : items.slice(offset, offset + limit);

  // A foto é resolvida só para a página visível: numa clínica com centenas de
  // grupos, perguntar por todos a cada abertura seria trabalho jogado fora.
  const comFoto = await whichHavePictures(
    ctx.organizationId,
    visiveis.map((g) => g.jid),
  );

  return {
    items: visiveis.map((g) => ({
      ...g,
      photoUrl: comFoto.has(g.jid) ? `/api/foto-perfil?jid=${encodeURIComponent(g.jid)}` : null,
    })),
    total: filtro === "all" ? pagina.total : items.length,
    counts,
  };
}

/** Guarda o tamanho real do grupo, conhecido só quando ele é aberto. */
export async function rememberGroupSize(
  ctx: TenantContext,
  jid: string,
  participantCount: number,
): Promise<void> {
  if (participantCount <= 0) return;
  const connection = await getConnectionRow(ctx.organizationId);
  await db
    .insert(whatsappGroups)
    .values({
      organizationId: ctx.organizationId,
      connectionId: connection?.id ?? null,
      jid,
      participantCount,
    })
    .onConflictDoUpdate({
      target: [whatsappGroups.organizationId, whatsappGroups.jid],
      set: { participantCount, updatedAt: new Date() },
    });
}

export async function classifyGroup(
  ctx: TenantContext,
  jid: string,
  classification: GroupClassification,
): Promise<void> {
  const connection = await getConnectionRow(ctx.organizationId);
  await db
    .insert(whatsappGroups)
    .values({
      organizationId: ctx.organizationId,
      connectionId: connection?.id ?? null,
      jid,
      classification,
    })
    .onConflictDoUpdate({
      target: [whatsappGroups.organizationId, whatsappGroups.jid],
      set: { classification, updatedAt: new Date() },
    });
}

export async function toggleGroupPinned(ctx: TenantContext, jid: string, pinned: boolean): Promise<void> {
  const connection = await getConnectionRow(ctx.organizationId);
  await db
    .insert(whatsappGroups)
    .values({ organizationId: ctx.organizationId, connectionId: connection?.id ?? null, jid, pinned })
    .onConflictDoUpdate({
      target: [whatsappGroups.organizationId, whatsappGroups.jid],
      set: { pinned, updatedAt: new Date() },
    });
}

export type GroupThreadMessage = {
  id: number;
  body: string;
  senderName: string | null;
  direction: "inbound" | "outbound";
  messageType: string;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaFileName: string | null;
  audioTranscription: string | null;
  createdAt: Date;
};

/** Cria o fio local antes da primeira mensagem para que o grupo já seja respondível. */
export async function ensureGroupConversation(ctx: TenantContext, jid: string): Promise<number> {
  const connection = await getConnectionRow(ctx.organizationId);
  if (!connection) throw new Error("SEM_CONEXAO");
  const [snapshot] = await db
    .select({ name: whatsappGroups.name })
    .from(whatsappGroups)
    .where(and(eq(whatsappGroups.organizationId, ctx.organizationId), eq(whatsappGroups.jid, jid)))
    .limit(1);
  const resolved = await resolveConversation({
    organizationId: ctx.organizationId,
    connectionId: connection.id,
    remoteJid: jid,
    phone: null,
    contactName: snapshot?.name ?? jid.split("@")[0] ?? "Grupo",
    isGroup: true,
  });
  return resolved.conversationId;
}

/** Mensagens do grupo, reconciliadas com o histórico conhecido pela instância. */
export async function getGroupThread(
  ctx: TenantContext,
  jid: string,
): Promise<{ conversationId: number | null; messages: GroupThreadMessage[] }> {
  const conversationId = await ensureGroupConversation(ctx, jid);

  // A lista de grupos não traz mensagens. Buscar /message/find ao abrir o fio
  // recupera o que já aconteceu no celular; o lock evita repetir a consulta a
  // cada evento em todas as abas abertas.
  const redis = getRedis();
  const claimed = redis
    ? await redis.set(`groups:history-sync:${ctx.organizationId}:${jid}`, "1", "EX", 20, "NX").catch(() => null)
    : "OK";
  if (claimed === "OK") {
    await syncConversationHistory(ctx.organizationId, conversationId, 300, { includeGroups: true }).catch((error) => {
      console.warn("[grupos] histórico não reconciliado:", error instanceof Error ? error.message : error);
    });
  }

  const linhas = await db
    .select({
      id: messages.id,
      body: messages.body,
      senderName: messages.senderName,
      direction: messages.direction,
      messageType: messages.messageType,
      mediaUrl: messages.mediaUrl,
      mediaMimeType: messages.mediaMimeType,
      mediaFileName: messages.mediaFileName,
      audioTranscription: messages.audioTranscription,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(eq(messages.organizationId, ctx.organizationId), eq(messages.conversationId, conversationId)))
    .orderBy(desc(messages.createdAt))
    .limit(120);

  return { conversationId, messages: linhas.reverse() };
}

export const _refs = { ilike };
