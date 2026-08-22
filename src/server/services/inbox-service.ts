import "server-only";
import { and, asc, count, desc, eq, gte, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appointments,
  conversations,
  customers,
  messages,
  professionals,
  services,
  users,
} from "@/db/schema";
import type { TenantContext } from "@/server/auth";
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
    })
    .from(conversations)
    .leftJoin(customers, eq(customers.id, conversations.customerId))
    .leftJoin(assignee, eq(assignee.id, conversations.assignedUserId))
    .leftJoin(previous, eq(previous.id, conversations.lastAssignedUserId))
    .leftJoin(lastMessage, and(eq(lastMessage.conversationId, conversations.id), eq(lastMessage.rank, 1)))
    .where(
      and(
        eq(conversations.organizationId, ctx.organizationId),
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

  return rows.map((row) => ({
    ...row,
    aiPaused: Boolean(row.aiPausedAt),
    phone: row.phone ? formatBrPhone(row.phone) : null,
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
    .where(eq(conversations.organizationId, ctx.organizationId));
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
  visitsCount: number;
  totalSpentCents: number;
  lastVisitAt: Date | null;
  nextAppointment: { startsAt: Date; serviceName: string; professionalName: string } | null;
};

export type ConversationDetail = {
  conversation: {
    id: number;
    customerName: string;
    phone: string | null;
    channel: string;
    controlledBy: "ai" | "human" | "waiting";
    status: string;
    aiPaused: boolean;
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
        visitsCount: customers.visitsCount,
        totalSpentCents: customers.totalSpentCents,
        lastVisitAt: customers.lastVisitAt,
      })
      .from(customers)
      .where(eq(customers.id, conversation.customerId))
      .limit(1);

    const [next] = await db
      .select({
        startsAt: appointments.startsAt,
        serviceName: services.name,
        professionalName: professionals.name,
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
      .limit(1);

    if (customer) context = { ...customer, nextAppointment: next ?? null };
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
    },
    messages: rows,
    context,
  };
}

export const _refs = { count };
