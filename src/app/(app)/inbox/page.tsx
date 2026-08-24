import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth";
import {
  countByTab,
  type InboxTab,
  listConversations,
  listInboxAssignees,
} from "@/server/services/inbox-service";
import { getConnection } from "@/server/services/whatsapp-connection-service";
import { loadConversationAction } from "./actions";
import { InboxView } from "./inbox-view";

export const metadata = { title: "Inbox" };
export const dynamic = "force-dynamic";

const TABS: InboxTab[] = ["meus", "fila", "todos", "resolvidas"];

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ conversa?: string; aba?: string }>;
}) {
  const ctx = await requireSession();
  // O menu já declara minRole "staff" para o Inbox (app-shell.tsx), mas a
  // página nunca cobrou isso: bastava digitar /inbox na URL para uma
  // profissional ler todas as conversas da clínica e responder por elas.
  // Mesmo critério que /grupos já aplica.
  if (ctx.role === "professional") redirect("/hoje");

  const params = await searchParams;

  const requestedTab = TABS.find((t) => t === params.aba);
  const counts = await countByTab(ctx);
  // Abrir direto na fila quando não há nada atribuído a mim evita a primeira
  // impressão de inbox vazio enquanto há gente esperando.
  const tab: InboxTab = requestedTab ?? (counts.meus === 0 && counts.fila > 0 ? "fila" : "meus");

  const [conversations, connection, assignees] = await Promise.all([
    listConversations(ctx, { tab }),
    getConnection(ctx),
    listInboxAssignees(ctx),
  ]);

  const requested = params.conversa ? Number(params.conversa) : null;
  const selectedId = requested && Number.isFinite(requested) ? requested : null;

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
      counts={counts}
      initialDetail={initialDetail}
      initialSelectedId={selectedId}
      initialTab={tab}
      currentUserId={ctx.userId}
      assignees={assignees}
      whatsappConnected={connection?.status === "connected"}
      canSupervise={ctx.role === "owner" || ctx.role === "admin"}
      // Sempre verdadeiro aqui porque a própria página já devolve
      // 'professional' para /hoje. A prop existe para a tela não ter que
      // conhecer a regra de papel, e para o dia em que ela deixar de ser
      // a mesma do acesso à página.
      canStartConversation
    />
  );
}
