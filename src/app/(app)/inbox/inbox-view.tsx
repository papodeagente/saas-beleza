"use client";

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Bot,
  CalendarCheck,
  Check,
  CheckCheck,
  ChevronLeft,
  Clock,
  FileText,
  Image as ImageIcon,
  Inbox as InboxIcon,
  MessageSquare,
  Mic,
  Pause,
  Play,
  Send,
  TriangleAlert,
  User,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, DataRow } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Textarea } from "@/components/ui/input";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  type InboxDetail,
  listConversationsAction,
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
};

type Tab = "meus" | "fila" | "todos" | "resolvidas";

/** Mensagem que já está na tela mas ainda não foi confirmada pelo servidor. */
type Draft = { tempId: string; conversationId: number; body: string; failed: boolean };

const TABS: Array<{ id: Tab; label: string; icon: typeof InboxIcon }> = [
  { id: "meus", label: "Meus", icon: User },
  { id: "fila", label: "Fila", icon: InboxIcon },
  { id: "todos", label: "Todos", icon: Users },
  { id: "resolvidas", label: "Resolvidas", icon: Check },
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
}: {
  conversations: ConversationItem[];
  counts: { meus: number; fila: number; todos: number };
  initialDetail: InboxDetail | null;
  initialSelectedId: number | null;
  initialTab: Tab;
  currentUserId: number;
  whatsappConnected: boolean;
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
  const [draft, setDraft] = useState("");
  const [, startSending] = useTransition();
  const [, startSwitching] = useTransition();
  const [acting, startActing] = useTransition();
  const threadRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number | null>(null);

  const activeId = selectedId ?? initialDetail?.conversationId ?? null;
  const detail = activeId == null ? null : (cache[activeId] ?? null);
  const conversationDrafts = drafts.filter((d) => d.conversationId === activeId);
  const loading = activeId != null && !detail;

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [detail?.conversationId, detail?.messages.length, conversationDrafts.length]);

  const refreshList = useCallback(
    async (nextTab: Tab, term: string) => {
      const rows = await listConversationsAction({ tab: nextTab, search: term || undefined });
      setList(rows as ConversationItem[]);
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
        const loaded = await loadConversationAction(activeId);
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
    setDraft("");
    syncUrl(id);
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

  function send() {
    const body = draft.trim();
    if (!detail || !body) return;
    const tempId = `rascunho-${Date.now()}`;
    setDraft("");
    setDrafts((prev) => [...prev, { tempId, conversationId: detail.conversationId, body, failed: false }]);
    deliver(detail.conversationId, body, tempId);
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
      setTabCounts((prev) => ({ ...prev }));
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
    <div className="flex h-[calc(100dvh_-_56px_-_env(safe-area-inset-bottom))] md:h-dvh">
      {/* Lista de conversas */}
      <aside
        aria-label="Conversas"
        className={cn(
          "w-full shrink-0 flex-col overflow-y-auto border-r border-line bg-surface-raised md:flex md:w-[320px] lg:w-[360px]",
          selectedId == null ? "flex" : "hidden",
        )}
      >
        <div className="sticky top-0 z-10 border-b border-line bg-surface-raised px-4 py-3">
          <h1 className="text-title text-ink">Inbox</h1>
          {!whatsappConnected ? (
            <Link
              href="/whatsapp"
              className="mt-2 flex items-center gap-1.5 rounded-control bg-attention-soft px-2 py-1.5 text-caption text-attention"
            >
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
              WhatsApp não conectado. Conectar agora
            </Link>
          ) : null}
          <div className="mt-3 flex gap-1" role="tablist">
            {TABS.map((item) => {
              const active = tab === item.id;
              const badge =
                item.id === "meus" ? tabCounts.meus : item.id === "fila" ? tabCounts.fila : item.id === "todos" ? tabCounts.todos : 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => changeTab(item.id)}
                  className={cn(
                    "flex-1 rounded-control px-2 py-1.5 text-caption font-medium transition-colors",
                    active ? "bg-accent-soft text-accent" : "text-ink-secondary hover:bg-surface-sunken",
                  )}
                >
                  {item.label}
                  {badge > 0 ? <span className="ml-1 tabular">{badge}</span> : null}
                </button>
              );
            })}
          </div>
          <Input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Buscar por nome ou telefone"
            className="mt-2"
          />
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
            {list.map((conversation) => {
              const opened = conversation.id === selectedId;
              const active = conversation.id === activeId;
              return (
                <li key={conversation.id} className="border-b border-line">
                  <button
                    type="button"
                    onClick={() => open(conversation.id)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "flex w-full gap-2.5 border-l-[3px] py-3 pr-4 pl-[13px] text-left transition-colors duration-[120ms]",
                      "border-l-transparent hover:bg-surface-sunken",
                      active && "md:border-l-accent md:bg-accent-soft md:hover:bg-accent-soft",
                      opened && "border-l-accent bg-accent-soft hover:bg-accent-soft",
                    )}
                  >
                    <Avatar name={conversation.customerName} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={cn("truncate text-label text-ink", (active || opened) && "font-semibold")}>
                          {conversation.customerName}
                        </span>
                        {conversation.lastMessageAt ? (
                          <span suppressHydrationWarning className="shrink-0 text-meta text-ink-secondary tabular">
                            {relativeTime(conversation.lastMessageAt)}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-caption text-ink-secondary">
                          {conversation.lastMessageInbound ? "" : "Você: "}
                          {conversation.lastMessagePreview ?? "Sem mensagens"}
                        </span>
                        {conversation.unreadCount > 0 ? (
                          <span className="shrink-0 rounded-full bg-accent px-1.5 text-meta font-semibold text-white tabular">
                            {conversation.unreadCount}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
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
                            {conversation.assignedUserName}
                          </Badge>
                        ) : conversation.lastAssignedUserName ? (
                          <Badge tone="neutral">Antes: {conversation.lastAssignedUserName}</Badge>
                        ) : null}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
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
                <p className="flex min-w-0 items-center gap-1.5 text-caption text-ink-secondary">
                  <span className="truncate">{CHANNEL_LABEL[detail.channel] ?? detail.channel}</span>
                  {/* Telefone e responsável só entram quando há largura: com as
                      ações ao lado, três informações viram três reticências. */}
                  {detail.phone ? (
                    <>
                      <span aria-hidden className="hidden text-ink-tertiary xl:inline">·</span>
                      <span className="hidden truncate tabular xl:inline">{detail.phone}</span>
                    </>
                  ) : null}
                  {detail.assignedUserName ? (
                    <>
                      <span aria-hidden className="hidden text-ink-tertiary lg:inline">·</span>
                      <span className="hidden truncate lg:inline">com {detail.assignedUserName}</span>
                    </>
                  ) : null}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  variant={detail.aiPaused ? "secondary" : "ghost"}
                  size="sm"
                  className="h-11 md:h-8"
                  loading={acting}
                  onClick={toggleAiPause}
                  title={detail.aiPaused ? "Retomar respostas automáticas" : "Parar respostas automáticas nesta conversa"}
                >
                  {detail.aiPaused ? <Play aria-hidden /> : <Pause aria-hidden />}
                  <span className="hidden sm:inline">{detail.aiPaused ? "Retomar IA" : "Pausar IA"}</span>
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
                    <Button variant="secondary" size="sm" className="h-11 md:h-8" loading={acting} onClick={() => assignment("resolver")}>
                      <Check aria-hidden />
                      <span className="hidden sm:inline">Resolver</span>
                    </Button>
                  </>
                ) : (
                  <Button variant="primary" size="sm" className="h-11 md:h-8" loading={acting} onClick={() => assignment("assumir")}>
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
                <ContextPanel context={detail.context} compact />
              </div>
              {/* A conversa cresce de baixo para cima: a última mensagem encosta
                  no composer, como em qualquer thread. */}
              <div className="mx-auto mt-auto flex w-full max-w-[680px] flex-col gap-2">
                {detail.messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
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
              {detail.hasWhatsapp ? (
                <div className="mx-auto flex max-w-[680px] items-end gap-2">
                  <Textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        send();
                      }
                    }}
                    rows={1}
                    placeholder="Escreva sua mensagem"
                    aria-label="Escrever mensagem"
                    aria-describedby="inbox-composer-hint"
                    className="max-h-32 min-h-11 flex-1 resize-none"
                  />
                  <Button
                    variant="primary"
                    size="md"
                    onClick={send}
                    disabled={!draft.trim()}
                    // Botão indisponível lê como indisponível, não como
                    // quebrado: superfície neutra em vez de bordeaux a 45%.
                    className="h-11 shrink-0 disabled:bg-surface-sunken disabled:text-ink-tertiary disabled:opacity-100"
                  >
                    <Send aria-hidden />
                    <span className="hidden sm:inline">Enviar</span>
                  </Button>
                </div>
              ) : null}
              {detail.hasWhatsapp ? (
                <p
                  id="inbox-composer-hint"
                  className="mx-auto mt-1.5 max-w-[680px] text-meta text-ink-secondary"
                >
                  Enter envia, Shift+Enter quebra a linha.
                </p>
              ) : (
                <p className="mx-auto max-w-[680px] text-center text-caption text-ink-secondary">
                  Esta conversa não tem número de WhatsApp, então não dá para responder por aqui.
                </p>
              )}
            </div>
          </>
        )}
      </section>

      {/* Contexto do cliente — a razão de não precisar sair do Inbox */}
      {detail ? (
        <aside
          aria-label="Contexto do cliente"
          className="hidden w-[var(--rail-width)] shrink-0 overflow-y-auto border-l border-line px-4 py-4 lg:block"
        >
          <ContextPanel context={detail.context} />
        </aside>
      ) : null}
    </div>
  );
}

/**
 * Ficha resumida do cliente. Par rótulo/valor via DataRow — a mesma unidade de
 * leitura do painel do atendimento e da ficha completa.
 */
function ContextPanel({
  context,
  compact = false,
}: {
  context: InboxDetail["context"];
  compact?: boolean;
}) {
  if (!context) {
    return (
      <Card className="px-4 py-3.5">
        <p className="text-card text-ink">Contato ainda não cadastrado</p>
        <p className="mt-1 text-caption text-ink-secondary">
          Ao agendar por esta conversa, o cliente é criado automaticamente.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card className="px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <Avatar name={context.name} size="lg" />
          <p className="min-w-0 truncate text-card text-ink">{context.name}</p>
        </div>

        <dl className="mt-3 border-t border-line pt-2">
          <DataRow label="Atendimentos">
            <span className="tabular">{context.visitsCount}</span>
          </DataRow>
          <DataRow label="Total gasto">
            <span className="tabular">{formatBRL(context.totalSpentCents)}</span>
          </DataRow>
          <DataRow label="Última visita">
            {context.lastVisitAt
              ? format(new Date(context.lastVisitAt), "d MMM yyyy", { locale: ptBR })
              : "Ainda não veio"}
          </DataRow>
        </dl>
      </Card>

      <Card className="px-4 py-3">
        <p className="flex items-center gap-1.5 text-section">
          <CalendarCheck className="size-3.5 text-ink-tertiary" aria-hidden />
          Próximo atendimento
        </p>
        {context.nextAppointment ? (
          <>
            <p className="mt-1.5 text-label text-ink">
              {format(new Date(context.nextAppointment.startsAt), "d 'de' MMM', 'HH:mm", {
                locale: ptBR,
              })}
            </p>
            <p className="text-caption text-ink-secondary">
              {context.nextAppointment.serviceName} ·{" "}
              {context.nextAppointment.professionalName.split(" ")[0]}
            </p>
          </>
        ) : (
          <p className="mt-1.5 text-caption text-ink-secondary">Sem horário marcado.</p>
        )}
      </Card>

      <div className={cn("gap-2", compact ? "flex" : "space-y-2")}>
        <Button
          variant="secondary"
          size="md"
          className={cn("h-11 md:h-9", compact ? "flex-1" : "w-full")}
          asChild
        >
          <Link href={`/agenda?novo=1&cliente=${context.customerId}`}>Agendar atendimento</Link>
        </Button>
        <Button
          variant="secondary"
          size="md"
          className={cn("h-11 md:h-9", compact ? "flex-1" : "w-full")}
          asChild
        >
          <Link href={`/clientes/${context.customerId}`}>Abrir ficha completa</Link>
        </Button>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: InboxDetail["messages"][number] }) {
  const outbound = message.direction === "outbound";
  const MediaIcon = MEDIA_ICON[message.messageType];

  if (message.sender === "system") {
    return (
      <p className="my-1 self-center rounded-control bg-surface-sunken px-2.5 py-1 text-center text-caption text-ink-secondary">
        {message.body}
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col", outbound ? "items-end" : "items-start")}>
      <div
        className={cn(
          // O bordeaux é reservado para ação e seleção: uma conversa inteira de
          // bolhas em accent-soft gasta o acento e some com a hierarquia.
          "max-w-[80%] rounded-card border px-3 py-2 text-body text-ink",
          outbound ? "border-line-strong bg-surface-sunken" : "border-line bg-surface-raised",
        )}
      >
        {MediaIcon && message.messageType !== "text" ? (
          <span className="mb-1 flex items-center gap-1.5 text-caption text-ink-secondary">
            <MediaIcon className="size-3.5" aria-hidden />
            {message.messageType === "audio"
              ? "Áudio"
              : message.messageType === "image"
                ? "Imagem"
                : message.messageType === "video"
                  ? "Vídeo"
                  : "Arquivo"}
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

/** Estado de entrega no padrão que todo mundo já conhece do WhatsApp. */
function DeliveryTick({ status }: { status: string }) {
  if (status === "failed") return <TriangleAlert className="size-3 text-danger" aria-label="falhou" />;
  if (status === "read") return <CheckCheck className="size-3 text-info" aria-label="lida" />;
  if (status === "delivered") return <CheckCheck className="size-3" aria-label="entregue" />;
  if (status === "pending") return <Clock className="size-3" aria-label="enviando" />;
  return <Check className="size-3" aria-label="enviada" />;
}
