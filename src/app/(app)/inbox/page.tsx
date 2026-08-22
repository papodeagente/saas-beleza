import { requireSession } from "@/server/auth";
import { listConversations } from "@/server/services/inbox-service";
import { loadConversationAction } from "./actions";
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

  const requested = params.conversa ? Number(params.conversa) : null;
  const selectedId =
    requested && conversations.some((c) => c.id === requested) ? requested : null;

  // O detalhe padrão existe para o desktop, onde os dois painéis convivem. No
  // celular a seleção começa vazia: a lista é a tela, e abrir uma conversa é
  // uma navegação com volta — sem isso a lista fica inalcançável.
  const defaultId = selectedId ?? conversations[0]?.id ?? null;
  const initialDetail = defaultId ? await loadConversationAction(defaultId) : null;

  return (
    <InboxView
      conversations={conversations.map((c) => ({
        ...c,
        lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
      }))}
      initialDetail={initialDetail}
      initialSelectedId={selectedId}
    />
  );
}
