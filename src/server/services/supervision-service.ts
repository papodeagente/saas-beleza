import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { conversations, customers, messages, organizationMembers, users } from "@/db/schema";
import type { TenantContext } from "@/server/auth";
import { aconteceuEm } from "@/server/services/inbox-service";

/**
 * Painel de supervisão.
 *
 * Responde três perguntas de quem coordena o atendimento: quem está atendendo
 * agora, quanto cada um está segurando, e há quanto tempo alguém espera na
 * fila. Tudo é derivado do que já aconteceu — nada depende de o atendente
 * lembrar de marcar um status, que é o campo que sempre fica desatualizado.
 */

/** Uma resposta enviada nos últimos minutos é o sinal mais honesto de presença. */
const JANELA_ATIVIDADE_MIN = 15;

export type AgentLoad = {
  userId: number;
  name: string;
  role: string;
  activeConversations: number;
  unreadMessages: number;
  lastActivityAt: Date | null;
  /** Derivado da última resposta enviada, não de um status escolhido à mão. */
  online: boolean;
  oldestWaitingMinutes: number | null;
};

export type QueueItem = {
  conversationId: number;
  customerName: string;
  phone: string | null;
  waitingSince: Date | null;
  waitingMinutes: number;
  unreadCount: number;
  lastMessagePreview: string | null;
  lastAssignedUserName: string | null;
};

export type SupervisionSnapshot = {
  agents: AgentLoad[];
  queue: QueueItem[];
  totals: {
    agentsOnline: number;
    agentsTotal: number;
    inService: number;
    unread: number;
    queueSize: number;
    oldestWaitMinutes: number;
    averagePerAgent: number;
  };
};

function minutosDesde(data: Date | null): number {
  if (!data) return 0;
  return Math.max(0, Math.round((Date.now() - data.getTime()) / 60_000));
}

export async function getSupervisionSnapshot(ctx: TenantContext): Promise<SupervisionSnapshot> {
  const agora = Date.now();

  const membros = await db
    .select({ userId: users.id, name: users.name, role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, ctx.organizationId));

  // Carga por atendente: conversas abertas atribuídas e não lidas somadas.
  const cargas = await db
    .select({
      userId: conversations.assignedUserId,
      total: sql<number>`count(*)::int`,
      unread: sql<number>`coalesce(sum(${conversations.unreadCount}), 0)::int`,
      oldestInbound: sql<Date | null>`min(${conversations.lastInboundAt})`,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.organizationId, ctx.organizationId),
        eq(conversations.status, "open"),
        sql`${conversations.assignedUserId} is not null`,
      ),
    )
    .groupBy(conversations.assignedUserId);

  // Última resposta enviada por cada pessoa — a prova de que está trabalhando.
  const atividades = await db
    .select({
      userId: messages.senderUserId,
      lastAt: sql<Date>`max(${messages.createdAt})`,
    })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, ctx.organizationId),
        eq(messages.direction, "outbound"),
        sql`${messages.senderUserId} is not null`,
      ),
    )
    .groupBy(messages.senderUserId);

  const cargaPor = new Map(cargas.map((c) => [c.userId, c]));
  const atividadePor = new Map(atividades.map((a) => [a.userId, a.lastAt]));

  const agents: AgentLoad[] = membros
    .map((membro) => {
      const carga = cargaPor.get(membro.userId);
      const lastAt = atividadePor.get(membro.userId) ?? null;
      const lastActivityAt = lastAt ? new Date(lastAt) : null;
      return {
        userId: membro.userId,
        name: membro.name,
        role: membro.role,
        activeConversations: carga?.total ?? 0,
        unreadMessages: carga?.unread ?? 0,
        lastActivityAt,
        online: lastActivityAt ? agora - lastActivityAt.getTime() < JANELA_ATIVIDADE_MIN * 60_000 : false,
        oldestWaitingMinutes: carga?.oldestInbound ? minutosDesde(new Date(carga.oldestInbound)) : null,
      };
    })
    .sort((a, b) => b.activeConversations - a.activeConversations || a.name.localeCompare(b.name));

  const filaBruta = await db
    .select({
      conversationId: conversations.id,
      customerName: sql<string>`coalesce(${customers.name}, ${conversations.contactName}, 'Contato sem cadastro')`,
      phone: sql<string | null>`coalesce(${customers.phone}, ${conversations.phone})`,
      waitingSince: conversations.lastInboundAt,
      unreadCount: conversations.unreadCount,
      lastAssignedUserName: users.name,
    })
    .from(conversations)
    .leftJoin(customers, eq(customers.id, conversations.customerId))
    .leftJoin(users, eq(users.id, conversations.lastAssignedUserId))
    .where(
      and(
        eq(conversations.organizationId, ctx.organizationId),
        eq(conversations.status, "open"),
        isNull(conversations.assignedUserId),
      ),
    )
    .orderBy(conversations.lastInboundAt)
    .limit(50);

  // Prévia da última mensagem de cada conversa da fila, numa consulta só.
  const ids = filaBruta.map((f) => f.conversationId);
  const previas = new Map<number, string>();
  if (ids.length > 0) {
    const linhas = await db
      .select({
        conversationId: messages.conversationId,
        body: messages.body,
        // Mesma régua do inbox: a prévia da fila é a ÚLTIMA mensagem da
        // conversa, e última é pelo que aconteceu, não pelo que foi gravado
        // por último.
        // O desempate por id vem junto: sem ele, duas mensagens do mesmo
        // segundo (183 linhas na base) fazem esta tela escolher uma e o Inbox
        // escolher a outra — a mesma conversa com duas prévias diferentes.
        rank: sql<number>`row_number() over (partition by ${messages.conversationId} order by ${aconteceuEm} desc, ${messages.id} desc)`.as(
          "rank",
        ),
      })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, ctx.organizationId),
          sql`${messages.conversationId} in ${ids}`,
        ),
      );
    for (const linha of linhas) {
      if (Number(linha.rank) === 1) previas.set(linha.conversationId, linha.body);
    }
  }

  const queue: QueueItem[] = filaBruta.map((item) => ({
    ...item,
    waitingMinutes: minutosDesde(item.waitingSince),
    lastMessagePreview: previas.get(item.conversationId) ?? null,
  }));

  const inService = agents.reduce((soma, a) => soma + a.activeConversations, 0);
  const comCarga = agents.filter((a) => a.activeConversations > 0).length;

  return {
    agents,
    queue,
    totals: {
      agentsOnline: agents.filter((a) => a.online).length,
      agentsTotal: agents.length,
      inService,
      unread: agents.reduce((soma, a) => soma + a.unreadMessages, 0),
      queueSize: queue.length,
      oldestWaitMinutes: queue.length > 0 ? Math.max(...queue.map((q) => q.waitingMinutes)) : 0,
      averagePerAgent: comCarga > 0 ? Math.round((inService / comCarga) * 10) / 10 : 0,
    },
  };
}

/** Entrega uma conversa da fila a alguém do time. */
export async function assignConversation(
  ctx: TenantContext,
  conversationId: number,
  userId: number,
): Promise<void> {
  const [membro] = await db
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, ctx.organizationId),
        eq(organizationMembers.userId, userId),
      ),
    )
    .limit(1);
  if (!membro) throw new Error("Essa pessoa não faz parte da equipe.");

  await db
    .update(conversations)
    .set({ assignedUserId: userId, assignedAt: new Date(), status: "open", resolvedAt: null })
    .where(
      and(eq(conversations.id, conversationId), eq(conversations.organizationId, ctx.organizationId)),
    );
}

export const _refs = { desc };
