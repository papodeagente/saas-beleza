import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth";
import {
  LIMITE_DA_LISTA,
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

  /**
   * A primeira lista já vem no escopo que o cliente vai usar.
   *
   * Meus, Fila e Todos são fatias das conversas ABERTAS: carregar as abertas
   * uma vez deixa a troca de aba sem nenhuma ida ao servidor. Só "Finalizadas"
   * (status diferente) e caixa acima do teto de linhas continuam vindo já
   * recortadas — recortar um retrato parcial no cliente mentiria sobre quantas
   * conversas cada aba tem.
   */
  const retratoCompleto = counts.todos <= LIMITE_DA_LISTA;
  const escopo = tab !== "resolvidas" && retratoCompleto ? "abertas" : "aba";

  const [conversations, connection, assignees] = await Promise.all([
    listConversations(ctx, escopo === "abertas" ? { tab: "todos" } : { tab }),
    getConnection(ctx),
    listInboxAssignees(ctx),
  ]);

  const requested = params.conversa ? Number(params.conversa) : null;
  const selectedId = requested && Number.isFinite(requested) ? requested : null;

  // O detalhe padrão existe para o desktop, onde os dois painéis convivem. No
  // celular a seleção começa vazia: a lista é a tela, e abrir uma conversa é
  // uma navegação com volta — sem isso a lista fica inalcançável.
  const visiveis =
    escopo === "abertas"
      ? conversations.filter((c) =>
          tab === "meus" ? c.assignedUserId === ctx.userId : tab === "fila" ? c.assignedUserId == null : true,
        )
      : conversations;
  const defaultId = selectedId ?? visiveis[0]?.id ?? null;
  /**
   * Marca lida só quando a conversa foi PEDIDA (`?conversa=`).
   *
   * A primeira da lista é escolha da tela, não da atendente — a mesma razão
   * pela qual a troca de aba abre a primeira com `marcarLida: false`. E o preço
   * de errar aqui subiu: o crachá agora é o maior entre o nosso não lido e o do
   * aparelho, então abrir a página apagava um "27 esperando" que ninguém leu.
   */
  const initialDetail = defaultId
    ? await loadConversationAction(defaultId, { markRead: selectedId != null })
    : null;

  return (
    <InboxView
      conversations={conversations.map((c) => ({
        ...c,
        lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
        providerLastAt: c.providerLastAt?.toISOString() ?? null,
        lastActivityAt: c.lastActivityAt?.toISOString() ?? null,
      }))}
      initialScope={escopo}
      retratoCompleto={retratoCompleto}
      counts={counts}
      initialDetail={initialDetail}
      // Sem detalhe não há o que abrir: repassar um id que o servidor não
      // devolveu (?conversa= apagada ou de outra conta) deixava a conversa
      // num esqueleto pulsando para sempre — no celular, sem botão de voltar.
      initialSelectedId={initialDetail ? selectedId : null}
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
