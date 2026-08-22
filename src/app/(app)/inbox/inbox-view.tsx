"use client";

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Bot, CalendarCheck, ChevronLeft, MessageSquare, Send, User } from "lucide-react";
import Link from "next/link";
import type * as React from "react";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, DataRow } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Textarea } from "@/components/ui/input";
import { formatBRL } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { type InboxDetail, loadConversationAction, sendMessageAction, setControlAction } from "./actions";

type ConversationItem = {
  id: number;
  customerId: number | null;
  customerName: string;
  channel: string;
  controlledBy: "ai" | "human" | "waiting";
  status: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageInbound: boolean;
  assignedUserName: string | null;
};

/** Mensagem que já está na tela mas ainda não foi confirmada pelo servidor. */
type Draft = {
  tempId: string;
  conversationId: number;
  body: string;
  failed: boolean;
};

/** Grafia dos canais: "whatsapp" nunca deve virar "Whatsapp" via CSS. */
const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  site: "Site",
};

/**
 * Vocabulário único do responsável pela conversa. O mesmo par de nomes aparece
 * na lista, no cabeçalho da conversa e no aviso de confirmação.
 */
const CONTROL: Record<
  ConversationItem["controlledBy"],
  { label: string; tone: "neutral" | "info" | "attention"; icon: typeof Bot }
> = {
  ai: { label: "Atendimento por IA", tone: "info", icon: Bot },
  human: { label: "Atendimento humano", tone: "neutral", icon: User },
  waiting: { label: "Aguardando atendente", tone: "attention", icon: User },
};

/** "há 46 min" — a forma curta usada em toda a lista. */
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
  initialDetail,
  initialSelectedId,
}: {
  conversations: ConversationItem[];
  initialDetail: InboxDetail | null;
  initialSelectedId: number | null;
}) {
  const [cache, setCache] = useState<Record<number, InboxDetail>>(() =>
    initialDetail ? { [initialDetail.conversationId]: initialDetail } : {},
  );
  // O que mudou nesta sessão sem recarregar a rota, aplicado sobre a lista do
  // servidor — evita copiar a lista inteira para o estado.
  const [patches, setPatches] = useState<Record<number, Partial<ConversationItem>>>({});
  const [selectedId, setSelectedId] = useState<number | null>(initialSelectedId);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draft, setDraft] = useState("");
  const [, startSending] = useTransition();
  const [, startSwitching] = useTransition();
  const [changingControl, startChangingControl] = useTransition();
  const threadRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number | null>(null);

  const list = conversations.map((item) =>
    patches[item.id] ? { ...item, ...patches[item.id] } : item,
  );

  // Sem seleção explícita o desktop mostra a conversa mais recente (os dois
  // painéis cabem juntos); o celular mostra a lista.
  const activeId = selectedId ?? initialDetail?.conversationId ?? null;
  const detail =
    activeId == null
      ? null
      : (cache[activeId] ??
        (initialDetail?.conversationId === activeId ? initialDetail : null));
  const conversationDrafts = drafts.filter((d) => d.conversationId === activeId);
  const loading = activeId != null && !detail;

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [detail?.conversationId, detail?.messages.length, conversationDrafts.length]);

  function syncUrl(id: number | null) {
    window.history.replaceState(null, "", id ? `/inbox?conversa=${id}` : "/inbox");
  }

  function open(id: number) {
    if (id === activeId && selectedId != null) return;
    setSelectedId(id);
    setDraft("");
    syncUrl(id);
    if (cache[id]) return;
    requestRef.current = id;
    startSwitching(async () => {
      const loaded = await loadConversationAction(id);
      if (requestRef.current !== id) return;
      if (loaded) setCache((prev) => ({ ...prev, [id]: loaded }));
      else toast.error("Não foi possível abrir a conversa.");
    });
  }

  function back() {
    setSelectedId(null);
    syncUrl(null);
  }

  /** Reflete na lista o que acabou de acontecer na conversa aberta. */
  function patchList(loaded: InboxDetail) {
    const last = loaded.messages.at(-1);
    setPatches((prev) => ({
      ...prev,
      [loaded.conversationId]: {
        ...prev[loaded.conversationId],
        controlledBy: loaded.controlledBy,
        ...(last
          ? {
              lastMessagePreview: last.body,
              lastMessageAt: last.createdAt,
              lastMessageInbound: last.direction === "inbound",
            }
          : {}),
      },
    }));
  }

  function deliver(conversationId: number, body: string, tempId: string) {
    startSending(async () => {
      const result = await sendMessageAction({ conversationId, body });
      if (!result.ok) {
        setDrafts((prev) => prev.map((d) => (d.tempId === tempId ? { ...d, failed: true } : d)));
        toast.error(result.error);
        return;
      }
      const loaded = await loadConversationAction(conversationId);
      if (loaded) {
        setCache((prev) => ({ ...prev, [conversationId]: loaded }));
        patchList(loaded);
      }
      // Sem toast de sucesso: a bolha na conversa já é a confirmação.
      setDrafts((prev) => prev.filter((d) => d.tempId !== tempId));
    });
  }

  function send() {
    const body = draft.trim();
    if (!detail || !body) return;
    const tempId = `rascunho-${Date.now()}`;
    setDraft("");
    setDrafts((prev) => [
      ...prev,
      { tempId, conversationId: detail.conversationId, body, failed: false },
    ]);
    deliver(detail.conversationId, body, tempId);
  }

  function retry(item: Draft) {
    setDrafts((prev) => prev.map((d) => (d.tempId === item.tempId ? { ...d, failed: false } : d)));
    deliver(item.conversationId, item.body, item.tempId);
  }

  function discard(tempId: string) {
    setDrafts((prev) => prev.filter((d) => d.tempId !== tempId));
  }

  function setControl(controlledBy: "ai" | "human") {
    if (!detail) return;
    const conversationId = detail.conversationId;
    startChangingControl(async () => {
      const result = await setControlAction({ conversationId, controlledBy });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setCache((prev) =>
        prev[conversationId] ? { ...prev, [conversationId]: { ...prev[conversationId], controlledBy } } : prev,
      );
      setPatches((prev) => ({
        ...prev,
        [conversationId]: { ...prev[conversationId], controlledBy },
      }));
      toast.success(
        controlledBy === "ai" ? "Conversa devolvida para a IA" : "Conversa assumida",
      );
    });
  }

  if (list.length === 0) {
    return (
      <div className="flex min-h-[70dvh] items-center justify-center">
        <EmptyState
          icon={MessageSquare}
          title="Nenhuma conversa ainda"
          description="As conversas com clientes aparecem aqui, cada uma com o histórico da pessoa ao lado — quantos atendimentos já fez e qual é o próximo horário."
          action={
            <Button variant="secondary" size="md" asChild>
              <Link href="/gestao">Ver configurações</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const control = detail ? CONTROL[detail.controlledBy] : null;
  const ControlIcon = control?.icon ?? Bot;

  return (
    <div className="flex h-[calc(100dvh_-_56px_-_env(safe-area-inset-bottom))] md:h-dvh">
      {/* Lista de conversas */}
      <aside
        aria-label="Conversas"
        className={cn(
          "w-full shrink-0 flex-col overflow-y-auto border-r border-line bg-surface-raised md:flex md:w-[300px] lg:w-[320px]",
          selectedId == null ? "flex" : "hidden",
        )}
      >
        <div className="sticky top-0 z-10 border-b border-line bg-surface-raised px-4 py-3">
          <h1 className="text-title text-ink">Inbox</h1>
          <p className="text-caption text-ink-secondary">
            {list.length} {list.length === 1 ? "conversa" : "conversas"}
          </p>
        </div>
        <ul>
          {list.map((conversation) => {
            // No celular a lista é a tela inteira: só marcamos a conversa
            // aberta. No desktop, os dois painéis convivem e a conversa
            // exibida por padrão também precisa aparecer marcada.
            const opened = conversation.id === selectedId;
            const active = conversation.id === activeId;
            const tag = CONTROL[conversation.controlledBy];
            const TagIcon = tag.icon;
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
                      <span
                        className={cn(
                          "truncate text-label text-ink",
                          active && "md:font-semibold",
                          opened && "font-semibold",
                        )}
                      >
                        {conversation.customerName}
                      </span>
                      {conversation.lastMessageAt ? (
                        <span
                          suppressHydrationWarning
                          className="shrink-0 text-meta text-ink-secondary tabular"
                        >
                          {relativeTime(conversation.lastMessageAt)}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-caption text-ink-secondary">
                      {conversation.lastMessageInbound ? "" : "Você: "}
                      {conversation.lastMessagePreview ?? "Sem mensagens"}
                    </span>
                    <span className="mt-1.5 flex items-center gap-1.5">
                      <Badge tone={tag.tone}>
                        <TagIcon className="size-3" aria-hidden />
                        {tag.label}
                      </Badge>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Conversa */}
      <section
        className={cn(
          "min-w-0 flex-1 flex-col bg-surface md:flex",
          selectedId == null ? "hidden" : "flex",
        )}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-raised px-3 py-2 md:px-5 md:py-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-11 shrink-0 px-2 md:hidden"
            onClick={back}
          >
            <ChevronLeft aria-hidden />
            Conversas
          </Button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-card text-ink">{detail?.customerName ?? "Conversa"}</h2>
            <p className="flex items-center gap-1.5 text-caption text-ink-secondary">
              <span className="truncate">
                {detail ? (CHANNEL_LABEL[detail.channel] ?? detail.channel) : "Carregando"}
              </span>
              {control ? (
                <>
                  <span aria-hidden className="text-ink-tertiary">
                    ·
                  </span>
                  <span className="inline-flex items-center gap-1 truncate">
                    <ControlIcon className="size-3 text-ink-tertiary" aria-hidden />
                    {control.label}
                  </span>
                </>
              ) : null}
            </p>
          </div>
          {detail ? (
            detail.controlledBy === "human" ? (
              <Button
                variant="secondary"
                size="sm"
                className="h-11 shrink-0 md:h-8"
                loading={changingControl}
                onClick={() => setControl("ai")}
              >
                <Bot aria-hidden />
                <span className="hidden sm:inline">Devolver para a IA</span>
                <span className="sm:hidden">Devolver</span>
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                className="h-11 shrink-0 md:h-8"
                loading={changingControl}
                onClick={() => setControl("human")}
              >
                <User aria-hidden />
                <span className="hidden sm:inline">Assumir conversa</span>
                <span className="sm:hidden">Assumir</span>
              </Button>
            )
          ) : null}
        </header>

        <div
          ref={threadRef}
          role="log"
          aria-label="Mensagens da conversa"
          className="flex flex-1 flex-col overflow-y-auto px-4 py-4 md:px-5"
        >
          {/* O contexto vive no trilho lateral; abaixo de lg ele abre a conversa,
              para não sumir justamente onde trocar de tela custa mais. */}
          {detail ? (
            <div className="mb-4 shrink-0 lg:hidden">
              <ContextPanel context={detail.context} compact />
            </div>
          ) : null}

          {loading ? (
            <ThreadSkeleton />
          ) : (
            /* Conversa cresce de baixo para cima: a última mensagem encosta no
               composer, como em qualquer thread. */
            <div className="mt-auto space-y-3">
              {detail?.messages.map((message) => (
                <Bubble
                  key={message.id}
                  outbound={message.direction === "outbound"}
                  body={message.body}
                  meta={
                    <>
                      {message.sender === "ai" ? "IA · " : null}
                      {message.sender === "user" ? "Você · " : null}
                      <time dateTime={message.createdAt}>
                        {format(new Date(message.createdAt), "HH:mm")}
                      </time>
                    </>
                  }
                />
              ))}

              {conversationDrafts.map((item) => (
                <Bubble
                  key={item.tempId}
                  outbound
                  body={item.body}
                  muted={!item.failed}
                  meta={
                    item.failed ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-danger">Não foi registrada</span>
                        <button
                          type="button"
                          onClick={() => retry(item)}
                          className="rounded-control font-medium text-accent underline-offset-2 hover:underline"
                        >
                          Tentar de novo
                        </button>
                        <button
                          type="button"
                          onClick={() => discard(item.tempId)}
                          className="rounded-control underline-offset-2 hover:underline"
                        >
                          Descartar
                        </button>
                      </span>
                    ) : (
                      <span aria-live="polite">Enviando…</span>
                    )
                  }
                />
              ))}

              {detail && detail.messages.length === 0 && conversationDrafts.length === 0 ? (
                <p className="py-6 text-center text-caption text-ink-secondary">
                  Nenhuma mensagem nesta conversa ainda.
                </p>
              ) : null}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-line bg-surface-raised px-4 py-3 shadow-sticky md:px-5">
          <div className="flex items-end gap-2">
            <Textarea
              rows={2}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder="Escreva sua resposta"
              aria-label="Escrever mensagem"
              aria-describedby="inbox-composer-hint"
              disabled={!detail}
              className="min-h-[52px] resize-none"
            />
            <Button
              variant="primary"
              size="md"
              className="h-11 shrink-0 px-4 md:h-9"
              disabled={!draft.trim() || !detail}
              onClick={send}
            >
              <Send aria-hidden />
              Enviar
            </Button>
          </div>
          <p id="inbox-composer-hint" className="mt-1.5 text-meta text-ink-secondary">
            Enter envia, Shift+Enter quebra a linha. A resposta fica registrada na conversa — este
            canal ainda não entrega mensagens ao cliente.
          </p>
        </div>
      </section>

      {/* Contexto do cliente — a razão de não precisar sair do Inbox */}
      <aside
        aria-label="Contexto do cliente"
        className="hidden w-[var(--rail-width)] shrink-0 overflow-y-auto border-l border-line px-4 py-4 lg:block"
      >
        {detail ? <ContextPanel context={detail.context} /> : null}
      </aside>
    </div>
  );
}

function Bubble({
  outbound,
  body,
  meta,
  muted = false,
}: {
  outbound: boolean;
  body: string;
  meta: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div className={cn("flex", outbound ? "justify-end" : "justify-start")}>
      <div className="max-w-[76%]">
        <div
          className={cn(
            "rounded-card border px-3 py-2 text-body whitespace-pre-wrap text-ink",
            outbound ? "border-line-strong bg-surface-sunken" : "border-line bg-surface-raised",
            muted && "opacity-60",
          )}
        >
          {body}
        </div>
        <p
          className={cn("mt-1 text-meta text-ink-secondary", outbound ? "text-right" : "text-left")}
        >
          {meta}
        </p>
      </div>
    </div>
  );
}

function ThreadSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      {[0, 1, 2].map((index) => (
        <div key={index} className={cn("flex", index % 2 ? "justify-end" : "justify-start")}>
          <div
            className="h-12 animate-pulse rounded-card bg-surface-sunken"
            style={{ width: index % 2 ? "48%" : "62%" }}
          />
        </div>
      ))}
    </div>
  );
}

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
          <div className="min-w-0">
            <p className="truncate text-card text-ink">{context.name}</p>
            {context.phone ? (
              <p className="text-caption text-ink-secondary tabular">{formatPhone(context.phone)}</p>
            ) : null}
          </div>
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
