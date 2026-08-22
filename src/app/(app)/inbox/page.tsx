import { requireSession } from "@/server/auth";
import { getConversation, listConversations } from "@/server/services/inbox-service";
import { InboxView } from "./inbox-view";

export const metadata = { title: "Inbox — Lumina" };
export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ conversa?: string }>;
}) {
  const ctx = await requireSession();
  const params = await searchParams;
  const conversations = await listConversations(ctx);

  const selectedId = params.conversa ? Number(params.conversa) : conversations[0]?.id;
  const detail = selectedId ? await getConversation(ctx, selectedId) : null;

  return (
    <InboxView
      conversations={conversations.map((c) => ({
        ...c,
        lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
      }))}
      detail={
        detail
          ? {
              conversationId: detail.conversation.id,
              controlledBy: detail.conversation.controlledBy,
              customerName: detail.conversation.customerName,
              channel: detail.conversation.channel,
              messages: detail.messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
              context: detail.context
                ? {
                    ...detail.context,
                    lastVisitAt: detail.context.lastVisitAt?.toISOString() ?? null,
                    nextAppointment: detail.context.nextAppointment
                      ? {
                          ...detail.context.nextAppointment,
                          startsAt: detail.context.nextAppointment.startsAt.toISOString(),
                        }
                      : null,
                  }
                : null,
            }
          : null
      }
    />
  );
}
