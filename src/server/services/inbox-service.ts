import "server-only";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
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

/**
 * Inbox: conversa + contexto do cliente na mesma tela.
 * A regra é zero troca de contexto — tudo o que o atendente precisa para
 * responder (histórico, próximo horário, quanto gastou) vive aqui.
 */

export type ConversationListItem = {
  id: number;
  customerId: number | null;
  customerName: string;
  channel: string;
  controlledBy: "ai" | "human" | "waiting";
  status: string;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  lastMessageInbound: boolean;
  assignedUserName: string | null;
};

export async function listConversations(ctx: TenantContext): Promise<ConversationListItem[]> {
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

  return db
    .select({
      id: conversations.id,
      customerId: conversations.customerId,
      customerName: sql<string>`coalesce(${customers.name}, 'Contato sem cadastro')`,
      channel: conversations.channel,
      controlledBy: conversations.controlledBy,
      status: conversations.status,
      lastMessageAt: conversations.lastMessageAt,
      lastMessagePreview: lastMessage.body,
      lastMessageInbound: sql<boolean>`${lastMessage.direction} = 'inbound'`,
      assignedUserName: users.name,
    })
    .from(conversations)
    .leftJoin(customers, eq(customers.id, conversations.customerId))
    .leftJoin(users, eq(users.id, conversations.assignedUserId))
    .leftJoin(lastMessage, and(eq(lastMessage.conversationId, conversations.id), eq(lastMessage.rank, 1)))
    .where(eq(conversations.organizationId, ctx.organizationId))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(60);
}

export type ConversationDetail = {
  conversation: ConversationListItem;
  messages: Array<{
    id: number;
    direction: "inbound" | "outbound";
    sender: "customer" | "user" | "ai" | "system";
    body: string;
    createdAt: Date;
  }>;
  context: {
    customerId: number;
    name: string;
    phone: string | null;
    visitsCount: number;
    totalSpentCents: number;
    lastVisitAt: Date | null;
    nextAppointment: { startsAt: Date; serviceName: string; professionalName: string } | null;
  } | null;
};

export async function getConversation(
  ctx: TenantContext,
  conversationId: number,
): Promise<ConversationDetail | null> {
  const list = await listConversations(ctx);
  const conversation = list.find((c) => c.id === conversationId);
  if (!conversation) return null;

  const messageRows = await db
    .select({
      id: messages.id,
      direction: messages.direction,
      sender: messages.sender,
      body: messages.body,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(
      and(eq(messages.organizationId, ctx.organizationId), eq(messages.conversationId, conversationId)),
    )
    .orderBy(asc(messages.createdAt))
    .limit(200);

  let context: ConversationDetail["context"] = null;
  if (conversation.customerId) {
    const [customer] = await db
      .select({
        id: customers.id,
        name: customers.name,
        phone: customers.phone,
        visitsCount: customers.visitsCount,
        totalSpentCents: customers.totalSpentCents,
        lastVisitAt: customers.lastVisitAt,
      })
      .from(customers)
      .where(
        and(eq(customers.id, conversation.customerId), eq(customers.organizationId, ctx.organizationId)),
      )
      .limit(1);

    if (customer) {
      const [upcoming] = await db
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
            eq(appointments.customerId, customer.id),
            gt(appointments.startsAt, new Date()),
            sql`${appointments.status} in ('scheduled','confirmed','checked_in','in_progress')`,
          ),
        )
        .orderBy(asc(appointments.startsAt))
        .limit(1);

      context = {
        customerId: customer.id,
        name: customer.name,
        phone: customer.phone,
        visitsCount: customer.visitsCount,
        totalSpentCents: customer.totalSpentCents,
        lastVisitAt: customer.lastVisitAt,
        nextAppointment: upcoming ?? null,
      };
    }
  }

  return { conversation, messages: messageRows, context };
}
