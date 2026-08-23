import "server-only";
import { and, asc, count, desc, eq, gte, ilike, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  appointments,
  conversations,
  customerTagLinks,
  customerTags,
  customers,
  messages,
  professionals,
  services,
  users,
  whatsappProfilePictures,
} from "@/db/schema";
import type { TenantContext } from "@/server/auth";
import { whichHavePictures } from "@/server/services/profile-picture-service";
import { formatBrPhone } from "@/server/whatsapp/phone";

/**
 * Inbox: a conversa e o contexto do cliente na mesma tela.
 *
 * A divisão em filas segue a regra trazida do entur-os-crm: "Meus" é o que
 * está atribuído a você, "Fila" é o que não tem dono e "Todos" é a visão do
 * time. Mensagem nova de conversa sem dono cai na fila mesmo que alguém já a
 * tenha atendido antes — quem atendeu por último aparece como contexto, não
 * como dono, porque essa pessoa pode estar de folga.
 */

export type InboxTab = "meus" | "fila" | "todos" | "resolvidas";

export type ConversationListItem = {
  id: number;
  customerId: number | null;
  customerName: string;
  phone: string | null;
  channel: string;
  controlledBy: "ai" | "human" | "waiting";
  status: string;
  aiPaused: boolean;
  unreadCount: number;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  lastMessageInbound: boolean;
  assignedUserId: number | null;
  assignedUserName: string | null;
  lastAssignedUserName: string | null;
  /**
   * Endereço da foto de perfil guardada, ou nulo quando não há foto para este
   * contato. Nulo faz o Avatar cair nas iniciais — pedir uma imagem que não
   * existe encheria o console de 404 e faria a lista piscar.
   */
  photoUrl: string | null;
};

function tabFilter(ctx: TenantContext, tab: InboxTab) {
  switch (tab) {
    case "meus":
      return and(eq(conversations.assignedUserId, ctx.userId), eq(conversations.status, "open"));
    case "fila":
      return and(isNull(conversations.assignedUserId), eq(conversations.status, "open"));
    case "resolvidas":
      return eq(conversations.status, "closed");
    default:
      return eq(conversations.status, "open");
  }
}

export async function listConversations(
  ctx: TenantContext,
  options: { tab?: InboxTab; search?: string } = {},
): Promise<ConversationListItem[]> {
  const tab = options.tab ?? "meus";
  const search = options.search?.trim();

  const lastMessage = db
    .select({
      conversationId: messages.conversationId,
      body: messages.body,
      direction: messages.direction,
      createdAt: messages.createdAt,
      rank: sql<number>`row_number() over (partition by ${messages.conversationId} order by ${messages.createdAt} desc)`.as(
        "rank",
      ),
    })
    .from(messages)
    .where(eq(messages.organizationId, ctx.organizationId))
    .as("last_message");

  // Alias porque a junção é por (organização, jid) e a mesma tabela pode voltar
  // a ser usada noutro ponto da consulta.
  const profilePic = alias(whatsappProfilePictures, "profile_pic");

  const assignee = db
    .select({ id: users.id, name: users.name })
    .from(users)
    .as("assignee");
  const previous = db
    .select({ id: users.id, name: users.name })
    .from(users)
    .as("previous_assignee");

  const rows = await db
    .select({
      id: conversations.id,
      customerId: conversations.customerId,
      customerName: sql<string>`coalesce(${customers.name}, ${conversations.contactName}, 'Contato sem cadastro')`,
      phone: sql<string | null>`coalesce(${customers.phone}, ${conversations.phone})`,
      channel: conversations.channel,
      controlledBy: conversations.controlledBy,
      status: conversations.status,
      aiPausedAt: conversations.aiPausedAt,
      unreadCount: conversations.unreadCount,
      lastMessageAt: conversations.lastMessageAt,
      lastMessagePreview: lastMessage.body,
      lastMessageInbound: sql<boolean>`${lastMessage.direction} = 'inbound'`,
      assignedUserId: conversations.assignedUserId,
      assignedUserName: assignee.name,
      lastAssignedUserName: previous.name,
      remoteJid: conversations.remoteJid,
      // Só a existência da foto vem no SELECT. Trazer os bytes aqui carregaria
      // ~2,6 KB por linha em toda abertura do inbox, para uma imagem que o
      // navegador já sabe guardar em cache sozinho.
      temFoto: sql<boolean>`${profilePic.id} is not null`,
    })
    .from(conversations)
    .leftJoin(
      profilePic,
      and(
        eq(profilePic.organizationId, conversations.organizationId),
        eq(profilePic.jid, conversations.remoteJid),
        eq(profilePic.missing, false),
      ),
    )
    .leftJoin(customers, eq(customers.id, conversations.customerId))
    .leftJoin(assignee, eq(assignee.id, conversations.assignedUserId))
    .leftJoin(previous, eq(previous.id, conversations.lastAssignedUserId))
    .leftJoin(lastMessage, and(eq(lastMessage.conversationId, conversations.id), eq(lastMessage.rank, 1)))
    .where(
      and(
        eq(conversations.organizationId, ctx.organizationId),
        // Grupo não é atendimento: tem caixa própria, com classificação em vez
        // de fila. Misturar os dois enche a fila de clientes com ruído.
        eq(conversations.isGroup, false),
        tabFilter(ctx, tab),
        search
          ? or(
              ilike(customers.name, `%${search}%`),
              ilike(conversations.contactName, `%${search}%`),
              ilike(conversations.phone, `%${search.replace(/\D/g, "")}%`),
            )
          : undefined,
      ),
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(100);

  return rows.map(({ remoteJid, temFoto, ...row }) => ({
    ...row,
    aiPaused: Boolean(row.aiPausedAt),
    phone: row.phone ? formatBrPhone(row.phone) : null,
    photoUrl:
      temFoto && remoteJid ? `/api/foto-perfil?jid=${encodeURIComponent(remoteJid)}` : null,
  }));
}

export type InboxCounts = { meus: number; fila: number; todos: number };

export async function countByTab(ctx: TenantContext): Promise<InboxCounts> {
  const [row] = await db
    .select({
      meus: sql<number>`count(*) filter (where ${conversations.assignedUserId} = ${ctx.userId} and ${conversations.status} = 'open')::int`,
      fila: sql<number>`count(*) filter (where ${conversations.assignedUserId} is null and ${conversations.status} = 'open')::int`,
      todos: sql<number>`count(*) filter (where ${conversations.status} = 'open')::int`,
    })
    .from(conversations)
    .where(and(eq(conversations.organizationId, ctx.organizationId), eq(conversations.isGroup, false)));
  return row ?? { meus: 0, fila: 0, todos: 0 };
}

export type ConversationMessage = {
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
  deletedAt: Date | null;
  createdAt: Date;
};

export type ConversationContext = {
  customerId: number;
  name: string;
  phone: string | null;
  email: string | null;
  visitsCount: number;
  noShowCount: number;
  totalSpentCents: number;
  lastVisitAt: Date | null;
  /** Derivado do histórico, não digitado: é o que resume a relação num olhar. */
  stage: "novo" | "ativo" | "recorrente" | "sumido";
  tags: string[];
  nextAppointments: Array<{
    id: number;
    startsAt: Date;
    serviceName: string;
    professionalName: string;
    status: string;
  }>;
};

/**
 * Estágio do cliente a partir do que aconteceu, não de um campo que alguém
 * precisa lembrar de atualizar.
 */
function customerStage(visits: number, lastVisitAt: Date | null): ConversationContext["stage"] {
  if (visits === 0) return "novo";
  const dias = lastVisitAt ? (Date.now() - lastVisitAt.getTime()) / 86_400_000 : Infinity;
  if (dias > 120) return "sumido";
  return visits >= 4 ? "recorrente" : "ativo";
}

export type ConversationDetail = {
  conversation: {
    id: number;
    customerName: string;
    phone: string | null;
    channel: string;
    controlledBy: "ai" | "human" | "waiting";
    status: string;
    aiPaused: boolean;
    /** Foto de perfil guardada, ou nulo quando não há. */
    photoUrl: string | null;
    assignedUserId: number | null;
    assignedUserName: string | null;
    lastAssignedUserName: string | null;
    hasWhatsapp: boolean;
  };
  messages: ConversationMessage[];
  context: ConversationContext | null;
};

export async function getConversation(
  ctx: TenantContext,
  conversationId: number,
): Promise<ConversationDetail | null> {
  const assignee = db.select({ id: users.id, name: users.name }).from(users).as("assignee");
  const previous = db.select({ id: users.id, name: users.name }).from(users).as("previous_assignee");

  const [conversation] = await db
    .select({
      id: conversations.id,
      customerId: conversations.customerId,
      customerName: sql<string>`coalesce(${customers.name}, ${conversations.contactName}, 'Contato sem cadastro')`,
      phone: sql<string | null>`coalesce(${customers.phone}, ${conversations.phone})`,
      channel: conversations.channel,
      controlledBy: conversations.controlledBy,
      status: conversations.status,
      aiPausedAt: conversations.aiPausedAt,
      assignedUserId: conversations.assignedUserId,
      assignedUserName: assignee.name,
      lastAssignedUserName: previous.name,
      remoteJid: conversations.remoteJid,
    })
    .from(conversations)
    .leftJoin(customers, eq(customers.id, conversations.customerId))
    .leftJoin(assignee, eq(assignee.id, conversations.assignedUserId))
    .leftJoin(previous, eq(previous.id, conversations.lastAssignedUserId))
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, ctx.organizationId)))
    .limit(1);
  if (!conversation) return null;

  // Consulta separada e não junção: a foto não participa de nenhum filtro e
  // uma leitura por chave única é mais barata que arrastar a tabela pela
  // junção da conversa inteira.
  const temFoto = conversation.remoteJid
    ? (await whichHavePictures(ctx.organizationId, [conversation.remoteJid])).size > 0
    : false;

  const sender = db.select({ id: users.id, name: users.name }).from(users).as("message_sender");
  const rows = await db
    .select({
      id: messages.id,
      direction: messages.direction,
      sender: messages.sender,
      senderName: sender.name,
      body: messages.body,
      messageType: messages.messageType,
      status: messages.status,
      mediaUrl: messages.mediaUrl,
      mediaMimeType: messages.mediaMimeType,
      mediaFileName: messages.mediaFileName,
      audioTranscription: messages.audioTranscription,
      externalId: messages.externalId,
      quotedExternalId: messages.quotedExternalId,
      // O jsonb chega como `unknown`; a forma é garantida por quem escreve
      // (applyReaction), então a asserção fica no único ponto de leitura.
      reactions: sql<Array<{ emoji: string; fromMe: boolean }> | null>`${messages.reactions}`,
      deletedAt: messages.deletedAt,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .leftJoin(sender, eq(sender.id, messages.senderUserId))
    .where(and(eq(messages.organizationId, ctx.organizationId), eq(messages.conversationId, conversationId)))
    .orderBy(asc(messages.createdAt))
    .limit(200);

  let context: ConversationContext | null = null;
  if (conversation.customerId) {
    const [customer] = await db
      .select({
        customerId: customers.id,
        name: customers.name,
        phone: customers.phone,
        email: customers.email,
        visitsCount: customers.visitsCount,
        noShowCount: customers.noShowCount,
        totalSpentCents: customers.totalSpentCents,
        lastVisitAt: customers.lastVisitAt,
      })
      .from(customers)
      .where(eq(customers.id, conversation.customerId))
      .limit(1);

    const proximos = await db
      .select({
        id: appointments.id,
        startsAt: appointments.startsAt,
        serviceName: services.name,
        professionalName: professionals.name,
        status: appointments.status,
      })
      .from(appointments)
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .innerJoin(professionals, eq(professionals.id, appointments.professionalId))
      .where(
        and(
          eq(appointments.organizationId, ctx.organizationId),
          eq(appointments.customerId, conversation.customerId),
          gte(appointments.startsAt, new Date()),
        ),
      )
      .orderBy(asc(appointments.startsAt))
      .limit(4);

    const tags = await db
      .select({ name: customerTags.name })
      .from(customerTagLinks)
      .innerJoin(customerTags, eq(customerTags.id, customerTagLinks.tagId))
      .where(eq(customerTagLinks.customerId, conversation.customerId))
      .limit(8);

    if (customer) {
      context = {
        ...customer,
        stage: customerStage(customer.visitsCount, customer.lastVisitAt),
        tags: tags.map((t) => t.name),
        nextAppointments: proximos,
      };
    }
  }

  return {
    conversation: {
      id: conversation.id,
      customerName: conversation.customerName,
      phone: conversation.phone ? formatBrPhone(conversation.phone) : null,
      channel: conversation.channel,
      controlledBy: conversation.controlledBy,
      status: conversation.status,
      aiPaused: Boolean(conversation.aiPausedAt),
      assignedUserId: conversation.assignedUserId,
      assignedUserName: conversation.assignedUserName,
      lastAssignedUserName: conversation.lastAssignedUserName,
      hasWhatsapp: Boolean(conversation.remoteJid),
      photoUrl:
        conversation.remoteJid && temFoto
          ? `/api/foto-perfil?jid=${encodeURIComponent(conversation.remoteJid)}`
          : null,
    },
    messages: rows,
    context,
  };
}

export const _refs = { count };
