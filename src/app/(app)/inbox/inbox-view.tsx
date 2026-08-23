"use client";

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Bot,
  CalendarCheck,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  Clock,
  FileText,
  Headphones,
  Image as ImageIcon,
  Inbox as InboxIcon,
  LayoutGrid,
  ListOrdered,
  Mail,
  MessageSquare,
  Mic,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Pencil,
  Phone,
  Play,
  Plus,
  ImageDown,
  Search,
  TriangleAlert,
  User,
  UserPlus,
  Users,
  UserX,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, DataRow } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { listGroupsAction } from "../grupos/actions";
import { loadMediaAction } from "./actions";
import { Composer, type ReplyTarget } from "./composer";
import { MessageActions } from "./message-actions";
import {
  type InboxDetail,
  listConversationsAction,
  syncPhotosAction,
  loadConversationAction,
  sendMessageAction,
  setAiPauseAction,
  updateAssignmentAction,
} from "./actions";

type ConversationItem = {
  id: number;
  customerId: number | null;
  customerName: string;
  phone: string | null;
  channel: string;
  controlledBy: "ai" | "human" | "waiting";
  status: string;
  aiPaused: boolean;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageInbound: boolean;
  assignedUserId: number | null;
  assignedUserName: string | null;
  lastAssignedUserName: string | null;
  photoUrl: string | null;
};

type Tab = "meus" | "fila" | "todos" | "resolvidas";

/** Mensagem que já está na tela mas ainda não foi confirmada pelo servidor. */
type Draft = { tempId: string; conversationId: number; body: string; failed: boolean };

const TABS: Array<{ id: Tab; label: string; icon: typeof InboxIcon }> = [
  { id: "meus", label: "Meus", icon: InboxIcon },
  { id: "fila", label: "Fila", icon: ListOrdered },
  { id: "todos", label: "Todos", icon: LayoutGrid },
  { id: "resolvidas", label: "Resolvidas", icon: CheckCircle2 },
];

/** Grafia dos canais: "whatsapp" nunca deve virar "Whatsapp" via CSS. */
const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  site: "Site",
};

const MEDIA_ICON: Partial<Record<string, typeof ImageIcon>> = {
  image: ImageIcon,
  video: ImageIcon,
  audio: Mic,
  document: FileText,
};

/** Atualização em segundo plano: sem isso a atendente precisa recarregar a página. */
const POLL_MS = 10_000;

function relativeTime(iso: string): string {
  const date = new Date(iso);
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `há ${days} d`;
  return format(date, "d MMM", { locale: ptBR });
}

export function InboxView({
  conversations,
  counts,
  initialDetail,
  initialSelectedId,
  initialTab,
  currentUserId,
  whatsappConnected,
  canSupervise,
}: {
  conversations: ConversationItem[];
  counts: { meus: number; fila: number; todos: number };
  initialDetail: InboxDetail | null;
  initialSelectedId: number | null;
  initialTab: Tab;
  currentUserId: number;
  whatsappConnected: boolean;
  canSupervise: boolean;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [search, setSearch] = useState("");
  const [list, setList] = useState<ConversationItem[]>(conversations);
  const [tabCounts, setTabCounts] = useState(counts);
  const [cache, setCache] = useState<Record<number, InboxDetail>>(() =>
    initialDetail ? { [initialDetail.conversationId]: initialDetail } : {},
  );
  const [selectedId, setSelectedId] = useState<number | null>(initialSelectedId);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  // Mensagem que está sendo respondida — some assim que o envio conclui.
  const [reply, setReply] = useState<ReplyTarget>(null);
  /**
   * Total de grupos, buscado depois que a tela aparece: a contagem vem do
   * WhatsApp e leva segundos, o que não pode atrasar a abertura do inbox.
   */
  const [groupCount, setGroupCount] = useState(0);
  /**
   * A ficha do cliente ocupa uma coluna inteira. Em tela larga ela cabe junto
   * com lista e conversa; abaixo disso, competir por espaço deixa a conversa
   * estreita demais para ler e escrever, então ela começa fechada e vira um
   * clique.
   */
  const fichaCabe = useSyncExternalStore(
    (aoMudar) => {
      const consulta = window.matchMedia("(min-width: 1536px)");
      consulta.addEventListener("change", aoMudar);
      return () => consulta.removeEventListener("change", aoMudar);
    },
    () => window.matchMedia("(min-width: 1536px)").matches,
    () => true,
  );
  const [fichaAberta, setFichaAberta] = useState<boolean | null>(null);
  const mostrarFicha = fichaAberta ?? fichaCabe;
  const [, startSending] = useTransition();
  const [, startSwitching] = useTransition();
  const [acting, startActing] = useTransition();
  const threadRef = useRef<HTMLDivElement>(null);
  const listReqRef = useRef(0);
  const requestRef = useRef<number | null>(null);

  const activeId = selectedId ?? initialDetail?.conversationId ?? null;
  const detail = activeId == null ? null : (cache[activeId] ?? null);
  const conversationDrafts = drafts.filter((d) => d.conversationId === activeId);
  const loading = activeId != null && !detail;

  useEffect(() => {
    if (!whatsappConnected) return;
    let ativo = true;
    void listGroupsAction({ limit: 1, offset: 0 }).then((resultado) => {
      if (ativo && resultado.ok) setGroupCount(resultado.data.total);
    });
    return () => {
      ativo = false;
    };
  }, [whatsappConnected]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [detail?.conversationId, detail?.messages.length, conversationDrafts.length]);

  /**
   * Recarrega a lista.
   *
   * A guarda de sequência não é preciosismo: sem ela, a resposta de uma
   * requisição antiga chegando depois de uma nova reescreve a lista com o
   * filtro errado. Foi reproduzido — clicar numa aba logo após a varredura
   * disparar deixava as conversas da aba anterior na tela por dez segundos, e
   * clicar numa delas abria conversa que não pertencia ao filtro.
   */
  const refreshList = useCallback(
    async (nextTab: Tab, term: string) => {
      const meu = (listReqRef.current += 1);
      const resultado = await listConversationsAction({ tab: nextTab, search: term || undefined });
      if (listReqRef.current !== meu) return;
      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }
      setList(resultado.rows as ConversationItem[]);
      // Os contadores viajam junto: antes eles vinham só no carregamento da
      // página e "Fila 3" continuava 3 enquanto chegavam mais dez.
      setTabCounts(resultado.counts);
    },
    [],
  );

  // Mensagem nova chega pelo webhook, sem avisar a tela. A varredura periódica
  // mantém a lista e a conversa aberta em dia.
  useEffect(() => {
    const timer = setInterval(async () => {
      if (document.hidden) return;
      await refreshList(tab, search);
      if (activeId) {
        const loaded = await loadConversationAction(activeId, { markRead: false });
        if (loaded) setCache((prev) => ({ ...prev, [activeId]: loaded }));
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [tab, search, activeId, refreshList]);

  function changeTab(next: Tab) {
    setTab(next);
    startSwitching(async () => {
      await refreshList(next, search);
    });
  }

  function onSearch(value: string) {
    setSearch(value);
    startSwitching(async () => {
      await refreshList(tab, value);
    });
  }

  function syncUrl(id: number | null) {
    window.history.replaceState(null, "", id ? `/inbox?conversa=${id}` : "/inbox");
  }

  function open(id: number) {
    setSelectedId(id);
    syncUrl(id);
    // Pelo mesmo motivo da `key` do Composer: o alvo de resposta é estado desta
    // tela e sobreviveria à troca, fazendo a mensagem sair citando a fala de
    // outra cliente.
    setReply(null);
    // Abrir zera o não lido; refletir na hora evita o contador fantasma.
    setList((prev) => prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
    requestRef.current = id;
    startSwitching(async () => {
      const loaded = await loadConversationAction(id);
      if (requestRef.current !== id) return;
      if (loaded) setCache((prev) => ({ ...prev, [id]: loaded }));
      else toast.error("Não foi possível abrir a conversa.");
    });
  }

  async function reload(conversationId: number) {
    const loaded = await loadConversationAction(conversationId);
    if (loaded) setCache((prev) => ({ ...prev, [conversationId]: loaded }));
    await refreshList(tab, search);
  }

  function deliver(conversationId: number, body: string, tempId: string) {
    startSending(async () => {
      const result = await sendMessageAction({ conversationId, body });
      if (!result.ok) {
        setDrafts((prev) => prev.map((d) => (d.tempId === tempId ? { ...d, failed: true } : d)));
        toast.error(result.error);
        return;
      }
      await reload(conversationId);
      // Sem toast de sucesso: a bolha na conversa já é a confirmação.
      setDrafts((prev) => prev.filter((d) => d.tempId !== tempId));
    });
  }


  function assignment(action: "assumir" | "devolver" | "resolver" | "reabrir") {
    if (!detail) return;
    const conversationId = detail.conversationId;
    startActing(async () => {
      const result = await updateAssignmentAction({ conversationId, action });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      await reload(conversationId);
      // `refreshList` já traz os contadores do servidor. O que havia aqui era
      // `setTabCounts((prev) => ({ ...prev }))`: um objeto novo com os MESMOS
      // valores, ou seja, nada. Assumir uma conversa não mexia no número.
      await refreshList(tab, search);
      toast.success(
        action === "assumir"
          ? "Conversa assumida"
          : action === "devolver"
            ? "Conversa devolvida para a fila"
            : action === "resolver"
              ? "Conversa resolvida"
              : "Conversa reaberta",
      );
    });
  }

  function toggleAiPause() {
    if (!detail) return;
    const conversationId = detail.conversationId;
    const paused = !detail.aiPaused;
    startActing(async () => {
      const result = await setAiPauseAction({ conversationId, paused });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      await reload(conversationId);
      toast.success(paused ? "IA pausada nesta conversa" : "IA retomada nesta conversa");
    });
  }

  const mine = detail?.assignedUserId === currentUserId;

  return (
    // Altura útil: no celular desconta a barra inferior, no desktop a do topo.
    <div className="flex h-[calc(100dvh_-_56px_-_env(safe-area-inset-bottom))] md:h-[calc(100dvh_-_var(--topbar-h,56px))]">
      {/* Lista de conversas */}
      <aside
        aria-label="Conversas"
        className={cn(
          "w-full shrink-0 flex-col overflow-y-auto border-r border-line bg-surface-raised md:flex md:w-[320px] lg:w-[360px]",
          selectedId == null ? "flex" : "hidden",
        )}
      >
        {/* Ações da caixa: o que vale para a fila inteira, não para uma conversa */}
        <div className="sticky top-0 z-10 flex flex-col gap-2 border-b border-line bg-surface-raised px-3 py-3">
          <div className="flex items-center gap-2">
            {canSupervise ? (
              <Button variant="primary" size="sm" className="h-9 flex-1" asChild>
                <Link href="/supervisao">
                  <Headphones aria-hidden />
                  Supervisão
                </Link>
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" className="h-9 flex-1" asChild>
              <Link href="/grupos">
                <Users aria-hidden />
                Grupos
                {groupCount > 0 ? <span className="tabular">{groupCount}</span> : null}
              </Link>
            </Button>
            <span
              title={whatsappConnected ? "WhatsApp conectado" : "WhatsApp desconectado"}
              className={cn(
                "size-2.5 shrink-0 rounded-full",
                whatsappConnected ? "bg-positive" : "bg-attention",
              )}
            />
          </div>

          {!whatsappConnected ? (
            <Link
              href="/whatsapp"
              className="flex items-center gap-1.5 rounded-control bg-attention-soft px-2 py-1.5 text-caption text-attention"
            >
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
              WhatsApp não conectado. Conectar agora
            </Link>
          ) : null}

          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-tertiary"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(event) => onSearch(event.target.value)}
                placeholder="Pesquisar conversa"
                className="pl-9"
              />
            </div>
            <BotaoFotos />
          </div>

          {/* Abas em ícone + rótulo: cabem cinco numa coluna estreita, e o
              número pendente fica colado no ícone, como aviso e não como texto. */}
          <div className="grid grid-cols-4 gap-1 rounded-card bg-surface-sunken p-1" role="tablist">
            {TABS.map((item) => {
              const active = tab === item.id;
              const badge =
                item.id === "meus"
                  ? tabCounts.meus
                  : item.id === "fila"
                    ? tabCounts.fila
                    : item.id === "todos"
                      ? tabCounts.todos
                      : 0;
              const TabIcon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => changeTab(item.id)}
                  className={cn(
                    "flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-control px-1 py-1.5 text-meta font-medium transition-colors",
                    active
                      ? "bg-surface-raised text-accent shadow-[var(--shadow-raised)]"
                      : "text-ink-secondary hover:text-ink",
                  )}
                >
                  <span className="relative flex items-center justify-center">
                    <TabIcon className="size-4 shrink-0" aria-hidden />
                    {badge > 0 ? (
                      <span className="absolute -top-1.5 -right-3 inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-white tabular">
                        {badge > 99 ? "99+" : badge}
                      </span>
                    ) : null}
                  </span>
                  <span className="max-w-full truncate leading-tight">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {list.length === 0 ? (
          <p className="px-4 py-8 text-center text-caption text-ink-secondary">
            {tab === "fila"
              ? "Nenhuma conversa esperando atendimento."
              : tab === "meus"
                ? "Você não tem conversas atribuídas."
                : "Nenhuma conversa aqui."}
          </p>
        ) : (
          <ul>
            {list.map((conversation) => (
              <li key={conversation.id} className="border-b border-line">
                <ConversationRow
                  conversation={conversation}
                  active={conversation.id === activeId}
                  opened={conversation.id === selectedId}
                  onOpen={() => open(conversation.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* Conversa */}
      <section className={cn("min-w-0 flex-1 flex-col bg-surface md:flex", selectedId == null ? "hidden" : "flex")}>
        {detail == null ? (
          <div className="flex flex-1 items-center justify-center">
            {loading ? (
              <p className="text-caption text-ink-secondary">Carregando conversa…</p>
            ) : (
              <EmptyState
                icon={MessageSquare}
                title="Escolha uma conversa"
                description="As conversas do WhatsApp aparecem à esquerda, com o histórico do cliente ao lado."
              />
            )}
          </div>
        ) : (
          <>
            <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface-raised px-3 py-2 md:px-5 md:py-3">
              <Button
                variant="ghost"
                size="sm"
                className="h-11 shrink-0 px-2 md:hidden"
                onClick={() => {
                  setSelectedId(null);
                  syncUrl(null);
                }}
              >
                <ChevronLeft aria-hidden />
                Conversas
              </Button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-card text-ink">{detail.customerName}</h2>
                {/* Uma linha só que trunca no fim: em três caixas separadas as
                    ações ao lado espremiam tudo e cada dado virava reticências. */}
                <p className="truncate text-caption text-ink-secondary">
                  {CHANNEL_LABEL[detail.channel] ?? detail.channel}
                  {detail.phone ? (
                    <span className="hidden xl:inline">
                      {" · "}
                      <span className="tabular">{detail.phone}</span>
                    </span>
                  ) : null}
                  {detail.assignedUserName ? (
                    <span className="hidden lg:inline">{` · com ${detail.assignedUserName}`}</span>
                  ) : null}
                </p>
              </div>

              {/* Abaixo de sm o rótulo some por CSS — e display:none também o
                  tira do leitor de tela. Daí o aria-label em cada ação. */}
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  variant={detail.aiPaused ? "secondary" : "ghost"}
                  size="sm"
                  className="h-11 md:h-8"
                  loading={acting}
                  onClick={toggleAiPause}
                  aria-label={detail.aiPaused ? "Retomar IA" : "Pausar IA"}
                  title={detail.aiPaused ? "Retomar respostas automáticas" : "Parar respostas automáticas nesta conversa"}
                >
                  {detail.aiPaused ? <Play aria-hidden /> : <Pause aria-hidden />}
                  <span className="hidden sm:inline">{detail.aiPaused ? "Retomar IA" : "Pausar IA"}</span>
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  className="hidden h-11 lg:inline-flex md:h-8"
                  aria-pressed={mostrarFicha}
                  title={mostrarFicha ? "Esconder a ficha do cliente" : "Mostrar a ficha do cliente"}
                  onClick={() => setFichaAberta(!mostrarFicha)}
                >
                  {mostrarFicha ? <PanelRightClose aria-hidden /> : <PanelRightOpen aria-hidden />}
                  <span className="hidden xl:inline">Ficha</span>
                </Button>

                {detail.status === "closed" ? (
                  <Button variant="secondary" size="sm" className="h-11 md:h-8" loading={acting} onClick={() => assignment("reabrir")}>
                    Reabrir
                  </Button>
                ) : mine ? (
                  <>
                    <Button variant="ghost" size="sm" className="h-11 md:h-8" loading={acting} onClick={() => assignment("devolver")}>
                      <span className="hidden sm:inline">Devolver à fila</span>
                      <span className="sm:hidden">Devolver</span>
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-11 md:h-8"
                      loading={acting}
                      aria-label="Resolver conversa"
                      onClick={() => assignment("resolver")}
                    >
                      <Check aria-hidden />
                      <span className="hidden sm:inline">Resolver</span>
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    className="h-11 md:h-8"
                    loading={acting}
                    aria-label="Assumir conversa"
                    onClick={() => assignment("assumir")}
                  >
                    <UserPlus aria-hidden />
                    <span className="hidden sm:inline">Assumir</span>
                  </Button>
                )}
              </div>
            </header>

            {detail.aiPaused ? (
              <p className="flex items-center gap-1.5 border-b border-line bg-attention-soft px-4 py-1.5 text-caption text-attention">
                <Pause className="size-3.5 shrink-0" aria-hidden />
                A IA está pausada nesta conversa. Nenhuma resposta automática sai daqui até você retomar.
              </p>
            ) : null}

            <div ref={threadRef} className="flex flex-1 flex-col overflow-y-auto px-3 py-4 md:px-6">
              {/* O contexto do cliente vive no trilho lateral; abaixo de lg ele
                  abre a conversa, para não sumir justamente no aparelho onde
                  trocar de tela custa mais. */}
              <div className="mx-auto mb-3 w-full max-w-[680px] shrink-0 lg:hidden">
                <ContactPanel context={detail.context} photoUrl={detail.photoUrl} compact />
              </div>
              {/* A conversa cresce de baixo para cima: a última mensagem encosta
                  no composer, como em qualquer thread. */}
              <div className="mx-auto mt-auto flex w-full max-w-[680px] flex-col gap-2">
                {detail.messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    conversationId={detail.conversationId}
                    quoted={
                      message.quotedExternalId
                        ? (detail.messages.find((m) => m.externalId === message.quotedExternalId) ?? null)
                        : null
                    }
                    onReply={() =>
                      setReply({
                        messageId: message.id,
                        externalId: message.externalId,
                        preview: (message.audioTranscription || message.body || "Mídia").slice(0, 80),
                        fromMe: message.direction === "outbound",
                      })
                    }
                    onChanged={() => void reload(detail.conversationId)}
                  />
                ))}
                {conversationDrafts.map((item) => (
                  <div key={item.tempId} className="flex flex-col items-end">
                    <div
                      className={cn(
                        "max-w-[80%] rounded-card border px-3 py-2 text-body",
                        item.failed
                          ? "border-danger/30 bg-danger-soft text-danger"
                          : "border-line-strong bg-surface-sunken text-ink opacity-60",
                      )}
                    >
                      {item.body}
                    </div>
                    {item.failed ? (
                      <div className="mt-1 flex justify-end gap-2 text-caption">
                        <button type="button" className="text-accent" onClick={() => deliver(item.conversationId, item.body, item.tempId)}>
                          Tentar de novo
                        </button>
                        <button
                          type="button"
                          className="text-ink-secondary"
                          onClick={() => setDrafts((prev) => prev.filter((d) => d.tempId !== item.tempId))}
                        >
                          Descartar
                        </button>
                      </div>
                    ) : (
                      /* O estado da bolha é o feedback do envio — por isso não
                         existe toast de sucesso. */
                      <span
                        aria-live="polite"
                        className="mt-0.5 flex items-center gap-1 px-1 text-meta text-ink-secondary"
                      >
                        <Clock className="size-3" aria-hidden />
                        Enviando…
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="shrink-0 border-t border-line bg-surface-raised px-3 py-2 shadow-sticky md:px-6 md:py-3">
              {/* A `key` não é detalhe: sem ela o Composer NÃO desmonta ao
                  trocar para uma conversa já carregada, e o texto digitado
                  para uma cliente aparece na conversa de outra. Numa clínica
                  isso é dado de uma paciente indo para outra. */}
              <Composer
                key={detail.conversationId}
                conversationId={detail.conversationId}
                disabled={!detail.hasWhatsapp}
                reply={reply}
                onClearReply={() => setReply(null)}
                onSent={() => void reload(detail.conversationId)}
              />
              {detail.hasWhatsapp ? (
                <p className="mx-auto mt-1.5 max-w-[680px] text-meta text-ink-secondary">
                  Enter envia, Shift+Enter quebra a linha.
                </p>
              ) : null}
            </div>
          </>
        )}
      </section>

      {/* Contexto do cliente — a razão de não precisar sair do Inbox */}
      {detail ? (
        <aside
          aria-label="Contexto do cliente"
          className={cn(
            "w-[var(--rail-width)] shrink-0 overflow-y-auto border-l border-line px-4 py-4",
            mostrarFicha ? "hidden lg:block" : "hidden",
          )}
        >
          <ContactPanel context={detail.context} photoUrl={detail.photoUrl} />
        </aside>
      ) : null}
    </div>
  );
}

/**
 * Ficha resumida do cliente. Par rótulo/valor via DataRow — a mesma unidade de
 * leitura do painel do atendimento e da ficha completa.
 */
/** Rótulo e tom do estágio, derivado do histórico e não de campo digitado. */
const STAGE: Record<string, { label: string; tone: "info" | "positive" | "accent" | "attention" }> = {
  novo: { label: "Cliente novo", tone: "info" },
  ativo: { label: "Cliente ativo", tone: "positive" },
  recorrente: { label: "Cliente fiel", tone: "accent" },
  sumido: { label: "Sem vir há tempo", tone: "attention" },
};

const APPOINTMENT_STATUS: Record<string, string> = {
  scheduled: "Agendado",
  confirmed: "Confirmado",
  checked_in: "Chegou",
  in_progress: "Em atendimento",
  completed: "Concluído",
  cancelled: "Cancelado",
  no_show: "Faltou",
};

/**
 * Ficha do cliente ao lado da conversa.
 *
 * A ordem responde ao que a atendente pergunta enquanto digita: quem é, como
 * falar com ele, o que já gastou aqui, e o que está marcado. Métricas em
 * cartões porque são consultadas de relance, no meio de uma frase.
 */
function ContactPanel({
  context,
  photoUrl,
  compact = false,
}: {
  context: InboxDetail["context"];
  /** Vem da conversa, não do cliente: a foto é do WhatsApp, não do cadastro. */
  photoUrl?: string | null;
  compact?: boolean;
}) {
  if (!context) {
    return (
      <div className="rounded-card border border-line bg-surface-raised px-4 py-3.5">
        <p className="text-card text-ink">Contato ainda não cadastrado</p>
        <p className="mt-1 text-caption text-ink-secondary">
          Ao agendar por esta conversa, o cliente é criado automaticamente.
        </p>
      </div>
    );
  }

  const stage = STAGE[context.stage] ?? STAGE.novo;

  return (
    <div className={cn("flex flex-col gap-3", compact && "rounded-card border border-line bg-surface-raised p-3")}>
      <div className="flex flex-col items-center gap-2 text-center">
        <Avatar name={context.name} src={photoUrl} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-card text-ink">{context.name}</p>
          <Badge tone={stage.tone} className="mt-1">
            {stage.label}
          </Badge>
        </div>
      </div>

      {context.tags.length > 0 ? (
        <div className="flex flex-wrap justify-center gap-1">
          {context.tags.map((tag) => (
            <Badge key={tag} tone="neutral">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5 border-t border-line pt-3 text-caption">
        {context.phone ? (
          <a
            href={`tel:${context.phone.replace(/\D/g, "")}`}
            className="flex items-center gap-2 text-ink hover:text-accent"
          >
            <Phone className="size-3.5 shrink-0 text-ink-tertiary" aria-hidden />
            <span className="truncate tabular">{formatPhone(context.phone)}</span>
          </a>
        ) : null}
        {context.email ? (
          <a href={`mailto:${context.email}`} className="flex items-center gap-2 text-ink hover:text-accent">
            <Mail className="size-3.5 shrink-0 text-ink-tertiary" aria-hidden />
            <span className="truncate">{context.email}</span>
          </a>
        ) : null}
        <Link
          href={`/clientes/${context.customerId}`}
          className="flex items-center gap-2 text-accent hover:underline"
        >
          <Pencil className="size-3.5 shrink-0" aria-hidden />
          Editar detalhes do cliente
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <MetricCard icon={CalendarCheck} label="Visitas" value={String(context.visitsCount)} tone="text-accent" />
        <MetricCard
          icon={Wallet}
          label="Total gasto"
          value={formatBRL(context.totalSpentCents)}
          tone="text-positive"
        />
        <MetricCard
          icon={UserX}
          label="Faltas"
          value={String(context.noShowCount)}
          tone={context.noShowCount > 0 ? "text-attention" : "text-ink-tertiary"}
        />
        <MetricCard
          icon={Clock}
          label="Última vez"
          value={
            context.lastVisitAt
              ? format(new Date(context.lastVisitAt), "dd/MM/yy", { locale: ptBR })
              : "—"
          }
          tone="text-info"
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-meta font-medium tracking-wide text-ink-secondary uppercase">
            Agendamentos ({context.nextAppointments.length})
          </span>
          <Link
            href={`/agenda?novo=1&cliente=${context.customerId}`}
            aria-label="Agendar atendimento"
            className="flex size-6 items-center justify-center rounded-control text-ink-secondary hover:bg-surface-sunken hover:text-ink"
          >
            <Plus className="size-4" aria-hidden />
          </Link>
        </div>

        {context.nextAppointments.length === 0 ? (
          <p className="rounded-control bg-surface-sunken px-2.5 py-3 text-center text-caption text-ink-secondary">
            Sem horário marcado.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {context.nextAppointments.map((item) => (
              <li key={item.id} className="rounded-control border border-line px-2.5 py-2">
                <p className="truncate text-label text-ink">{item.serviceName}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-caption text-ink-secondary">
                  <span className="tabular">
                    {format(new Date(item.startsAt), "dd/MM 'às' HH:mm", { locale: ptBR })}
                  </span>
                  <span aria-hidden>·</span>
                  <span className="truncate">{item.professionalName}</span>
                </p>
                <Badge tone={item.status === "confirmed" ? "positive" : "neutral"} className="mt-1">
                  {APPOINTMENT_STATUS[item.status] ?? item.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Button variant="secondary" size="md" className="h-10 w-full" asChild>
        <Link href={`/agenda?novo=1&cliente=${context.customerId}`}>
          <CalendarCheck aria-hidden />
          Agendar atendimento
        </Link>
      </Button>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof CalendarCheck;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="rounded-control border border-line bg-surface-raised px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <Icon className={cn("size-3.5 shrink-0", tone)} aria-hidden />
        <span className="truncate text-meta font-medium tracking-wide text-ink-secondary uppercase">{label}</span>
      </div>
      <p className="mt-0.5 truncate text-card text-ink tabular">{value}</p>
    </div>
  );
}

/**
 * Linha da lista de conversas.
 *
 * Densa de propósito: numa fila de dezenas, cada linha precisa responder em um
 * olhar quem é, o que foi dito, quando, e quem está cuidando. O selo do canal
 * fica sobre o avatar porque o canal é atributo da conversa, não informação
 * que mereça uma linha própria.
 */
/**
 * Puxa do WhatsApp as fotos que faltam.
 *
 * Fica ao lado da busca porque é uma manutenção da LISTA, não de uma conversa.
 * O rótulo some em tela estreita e sobra só o ícone: numa coluna de 320px, o
 * texto roubaria espaço da busca, que é o que se usa todo dia.
 */
function BotaoFotos() {
  const [pendente, iniciar] = useTransition();

  return (
    <button
      type="button"
      disabled={pendente}
      title="Buscar no WhatsApp as fotos de perfil que ainda faltam"
      onClick={() =>
        iniciar(async () => {
          const r = await syncPhotosAction();
          if (r.ok) toast.success(r.mensagem);
          else toast.error(r.error);
        })
      }
      className="flex h-9 shrink-0 items-center gap-1.5 rounded-control border border-line px-2.5 text-label text-ink-secondary transition-colors hover:border-line-strong hover:text-ink disabled:opacity-60"
    >
      <ImageDown className={cn("size-4", pendente && "animate-pulse")} aria-hidden />
      <span className="hidden lg:inline">{pendente ? "Buscando" : "Fotos"}</span>
    </button>
  );
}

function ConversationRow({
  conversation,
  active,
  opened,
  onOpen,
}: {
  conversation: ConversationItem;
  active: boolean;
  opened: boolean;
  onOpen: () => void;
}) {
  const naoLidas = conversation.unreadCount;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-3 border-l-[3px] py-3 pr-3 pl-[9px] text-left transition-colors duration-[120ms]",
        "border-l-transparent hover:bg-surface-sunken",
        active && "md:border-l-accent md:bg-accent-soft md:hover:bg-accent-soft",
        opened && "border-l-accent bg-accent-soft hover:bg-accent-soft",
      )}
    >
      <span className="relative shrink-0">
        <Avatar name={conversation.customerName} src={conversation.photoUrl} size="lg" />
        {/* Selo do canal, no padrão que todo aplicativo de mensagem usa. */}
        <span
          title={conversation.channel === "whatsapp" ? "WhatsApp" : conversation.channel}
          className="absolute -right-0.5 -bottom-0.5 flex size-[18px] items-center justify-center rounded-full bg-[#25D366] ring-2 ring-surface-raised"
        >
          <WhatsAppGlyph />
        </span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={cn("truncate text-label text-ink", naoLidas > 0 && "font-semibold")}>
            {conversation.customerName}
          </span>
          {conversation.lastMessageAt ? (
            <span suppressHydrationWarning className="shrink-0 text-meta text-ink-secondary tabular">
              {relativeTime(conversation.lastMessageAt)}
            </span>
          ) : null}
        </span>

        <span className="mt-0.5 flex items-center gap-1.5">
          {!conversation.lastMessageInbound ? (
            <Check className="size-3 shrink-0 text-ink-tertiary" aria-hidden />
          ) : null}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-caption",
              naoLidas > 0 ? "text-ink" : "text-ink-secondary",
            )}
          >
            {conversation.lastMessagePreview ?? "Sem mensagens"}
          </span>
          {naoLidas > 0 ? (
            <span className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white tabular">
              {naoLidas > 99 ? "99+" : naoLidas}
            </span>
          ) : null}
        </span>

        <span className="mt-1 flex flex-wrap items-center gap-1">
          {conversation.aiPaused ? (
            <Badge tone="attention">
              <Pause className="size-3" aria-hidden />
              IA pausada
            </Badge>
          ) : conversation.controlledBy === "ai" ? (
            <Badge tone="info">
              <Bot className="size-3" aria-hidden />
              IA atendendo
            </Badge>
          ) : null}
          {conversation.assignedUserName ? (
            <Badge tone="neutral">
              <User className="size-3" aria-hidden />
              {conversation.assignedUserName.split(" ")[0]}
            </Badge>
          ) : conversation.lastAssignedUserName ? (
            <Badge tone="neutral">Antes: {conversation.lastAssignedUserName.split(" ")[0]}</Badge>
          ) : null}
        </span>
      </span>
    </button>
  );
}

/** Marca do WhatsApp em traço único, para caber dentro do selo de 18px. */
function WhatsAppGlyph() {
  return (
    <svg viewBox="0 0 308 308" className="size-2.5 text-white" fill="currentColor" aria-hidden>
      <path d="M227.9 177c-.6-.3-23-11.3-26.7-12.6-3.6-1.3-6.3-1.9-8.9 1.9-2.6 3.9-10.2 12.6-12.5 15.2-2.3 2.6-4.6 2.9-8.6.9-3.9-2-16.7-6.1-31.8-19.5-11.7-10.4-19.7-23.3-22-27.3-2.3-3.9-.2-6.1 1.7-8.1 1.8-1.8 4-4.6 5.9-6.9 2-2.3 2.6-4 4-6.6 1.3-2.6.6-4.9-.3-6.9-1-2-8.9-21.4-12.2-29.3-3.2-7.7-6.5-6.7-8.9-6.8-2.3-.1-5-.1-7.6-.1s-6.9 1-10.6 4.9c-3.6 3.9-13.9 13.5-13.9 32.9s14.2 38.2 16.2 40.8c2 2.6 27.9 42.5 67.6 59.6 9.4 4.1 16.8 6.5 22.6 8.3 9.5 3 18.1 2.6 24.9 1.6 7.6-1.1 23.1-9.4 26.3-18.5 3.3-9.1 3.3-16.9 2.3-18.5-1-1.6-3.6-2.6-7.6-4.6zM156.7 0C73.3 0 5.5 67.4 5.5 150.1c0 26.8 7.2 53 20.7 75.9L0 308l84-25.7c21.9 11.7 46.6 17.8 71.6 17.8h.1c83.3 0 151.2-67.4 151.2-150.1C307 67.4 240.1 0 156.7 0zm0 275.6h-.1c-22.6 0-44.8-6.1-64.1-17.6l-4.6-2.7-47.7 12.5 12.7-46.3-3-4.8c-12.6-20-19.2-42.6-19.2-66 0-69.6 56.9-125.9 127.1-125.9 34 0 66 13.2 90 37.2 24 24 37.3 55.9 37.3 89.7-.1 69.6-57 125.5-127.4 125.5z" />
    </svg>
  );
}

type Message = InboxDetail["messages"][number];

function MessageBubble({
  message,
  conversationId,
  quoted,
  onReply,
  onChanged,
}: {
  message: Message;
  conversationId: number;
  quoted: Message | null;
  onReply: () => void;
  onChanged: () => void;
}) {
  const outbound = message.direction === "outbound";
  const MediaIcon = MEDIA_ICON[message.messageType];

  if (message.sender === "system") {
    return (
      <p className="my-1 self-center rounded-control bg-surface-sunken px-2.5 py-1 text-center text-caption text-ink-secondary">
        {message.body}
      </p>
    );
  }

  if (message.deleted) {
    return (
      <div className={cn("flex flex-col", outbound ? "items-end" : "items-start")}>
        <div className="max-w-[80%] rounded-card border border-dashed border-line px-3 py-2 text-body text-ink-tertiary italic">
          Mensagem apagada
        </div>
      </div>
    );
  }

  return (
    <div className={cn("group flex flex-col", outbound ? "items-end" : "items-start")}>
      <div className={cn("flex items-center gap-1", outbound ? "flex-row" : "flex-row-reverse")}>
        {/* As ações só aparecem no hover: a conversa fica limpa para ler. */}
        <MessageActions
          conversationId={conversationId}
          message={message}
          onReply={onReply}
          onChanged={onChanged}
        />
        <div
          className={cn(
            // O bordeaux é reservado para ação e seleção: uma conversa inteira de
            // bolhas em accent-soft gasta o acento e some com a hierarquia.
            // `break-words` não basta: um token colado sem espaço só quebra com
            // `anywhere`, e sem isso ele vaza da bolha e atravessa a coluna vizinha.
            "max-w-[80%] rounded-card border px-3 py-2 text-body text-ink [overflow-wrap:anywhere]",
            outbound ? "border-line-strong bg-surface-sunken" : "border-line bg-surface-raised",
          )}
        >
          {quoted ? (
            <span className="mb-1.5 block border-l-2 border-accent pl-2 text-caption text-ink-secondary [overflow-wrap:anywhere]">
              <span className="block font-medium text-accent">
                {quoted.direction === "outbound" ? "Você" : "Cliente"}
              </span>
              <span className="block truncate">
                {(quoted.audioTranscription || quoted.body || "Mídia").slice(0, 90)}
              </span>
            </span>
          ) : null}

          {message.messageType === "image" ? (
            message.mediaUrl ? (
              <a href={message.mediaUrl} target="_blank" rel="noreferrer" className="mb-1.5 block">
                <img
                  src={message.mediaUrl}
                  alt={message.body || "Imagem recebida"}
                  className="max-h-[280px] w-auto rounded-control"
                />
              </a>
            ) : (
              <MediaPlaceholder
                conversationId={conversationId}
                messageId={message.id}
                outbound={outbound}
                label="Imagem"
                onLoaded={onChanged}
              />
            )
          ) : null}

          {message.messageType === "audio" ? (
            message.mediaUrl ? (
              // Player nativo: toca sem sair da conversa e sem baixar nada.
              <audio controls src={message.mediaUrl} className="mb-1.5 h-9 w-[240px] max-w-full" />
            ) : (
              <MediaPlaceholder
                conversationId={conversationId}
                messageId={message.id}
                outbound={outbound}
                label="Mensagem de voz"
                onLoaded={onChanged}
              />
            )
          ) : null}

          {message.messageType === "video" && message.mediaUrl ? (
            <video controls src={message.mediaUrl} className="mb-1.5 max-h-[280px] w-auto rounded-control" />
          ) : null}

          {MediaIcon && message.messageType !== "text" && !["image", "audio", "video"].includes(message.messageType) ? (
            <span className="mb-1 flex items-center gap-1.5 text-caption text-ink-secondary">
              <MediaIcon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{message.mediaFileName || "Arquivo"}</span>
              {message.mediaUrl ? (
                <a href={message.mediaUrl} target="_blank" rel="noreferrer" className="text-accent">
                  abrir
                </a>
              ) : null}
            </span>
          ) : null}

          {/* Áudio transcrito aparece como texto: é o que a atendente precisa ler
              para responder sem ouvir tudo de novo. */}
          {message.audioTranscription ? (
            <span className="block whitespace-pre-wrap italic">{message.audioTranscription}</span>
          ) : message.body ? (
            <span className="block whitespace-pre-wrap">{message.body}</span>
          ) : null}
        </div>
      </div>

      {message.reactions && message.reactions.length > 0 ? (
        <span className="-mt-1 flex gap-0.5 rounded-full border border-line bg-surface-raised px-1.5 py-0.5 text-[13px] leading-none shadow-sm">
          {message.reactions.map((r, i) => (
            <span key={`${r.emoji}-${i}`}>{r.emoji}</span>
          ))}
        </span>
      ) : null}

      <span className="mt-0.5 flex items-center gap-1 px-1 text-meta text-ink-secondary">
        {message.sender === "ai" ? (
          <>
            <Bot className="size-3" aria-hidden />
            IA
          </>
        ) : message.senderName ? (
          message.senderName
        ) : null}
        <span suppressHydrationWarning>{format(new Date(message.createdAt), "HH:mm", { locale: ptBR })}</span>
        {outbound ? <DeliveryTick status={message.status} /> : null}
      </span>
    </div>
  );
}

/**
 * Mídia sem link.
 *
 * Acontece nos dois sentidos: o que enviamos vai em base64 e não deixa URL, e o
 * que chega nem sempre traz o link no webhook. Em vez de bolha vazia, mostra o
 * que é e — quando faz sentido buscar — oferece carregar.
 */
function MediaPlaceholder({
  conversationId,
  messageId,
  outbound,
  label,
  onLoaded,
}: {
  conversationId: number;
  messageId: number;
  outbound: boolean;
  label: string;
  onLoaded: () => void;
}) {
  const [carregando, startCarregando] = useTransition();

  return (
    <span className="mb-1 flex items-center gap-1.5 whitespace-nowrap text-caption text-ink-secondary">
      <Mic className="size-3.5 shrink-0" aria-hidden />
      {label}
      {!outbound ? (
        <button
          type="button"
          disabled={carregando}
          className="text-accent disabled:opacity-60"
          onClick={() =>
            startCarregando(async () => {
              const result = await loadMediaAction({ conversationId, messageId });
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              if (!result.url) {
                toast.error("A mídia não está mais disponível no WhatsApp.");
                return;
              }
              onLoaded();
            })
          }
        >
          {carregando ? "carregando…" : "carregar"}
        </button>
      ) : null}
    </span>
  );
}

/** Estado de entrega no padrão que todo mundo já conhece do WhatsApp. */
function DeliveryTick({ status }: { status: string }) {
  if (status === "failed") return <TriangleAlert className="size-3 text-danger" aria-label="falhou" />;
  if (status === "read") return <CheckCheck className="size-3 text-info" aria-label="lida" />;
  if (status === "delivered") return <CheckCheck className="size-3" aria-label="entregue" />;
  if (status === "pending") return <Clock className="size-3" aria-label="enviando" />;
  return <Check className="size-3" aria-label="enviada" />;
}
