"use client";

import { format, formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Bot, CalendarCheck, MessageSquare, Send, User } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Textarea } from "@/components/ui/input";
import { formatBRL } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { sendMessageAction, setControlAction } from "./actions";

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

type Detail = {
  conversationId: number;
  controlledBy: "ai" | "human" | "waiting";
  customerName: string;
  channel: string;
  messages: Array<{
    id: number;
    direction: "inbound" | "outbound";
    sender: "customer" | "user" | "ai" | "system";
    body: string;
    createdAt: string;
  }>;
  context: {
    customerId: number;
    name: string;
    phone: string | null;
    visitsCount: number;
    totalSpentCents: number;
    lastVisitAt: string | null;
    nextAppointment: { startsAt: string; serviceName: string; professionalName: string } | null;
  } | null;
};

/** Grafia dos canais: "whatsapp" nunca deve virar "Whatsapp" via CSS. */
const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  site: "Site",
};

const CONTROL: Record<string, { label: string; tone: "accent" | "info" | "attention" }> = {
  ai: { label: "IA respondendo", tone: "accent" },
  human: { label: "Atendimento humano", tone: "info" },
  waiting: { label: "Aguardando", tone: "attention" },
};

export function InboxView({
  conversations,
  detail,
}: {
  conversations: ConversationItem[];
  detail: Detail | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [detail?.conversationId, detail?.messages.length]);

  function select(id: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("conversa", String(id));
    router.push(`/inbox?${params.toString()}`);
  }

  function send() {
    if (!detail || !draft.trim()) return;
    const body = draft.trim();
    startTransition(async () => {
      const result = await sendMessageAction({ conversationId: detail.conversationId, body });
      if (result.ok) {
        setDraft("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function setControl(controlledBy: "ai" | "human") {
    if (!detail) return;
    startTransition(async () => {
      const result = await setControlAction({ conversationId: detail.conversationId, controlledBy });
      if (result.ok) {
        toast.success(
          controlledBy === "ai" ? "Conversa devolvida para a IA" : "Você assumiu esta conversa",
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  if (conversations.length === 0) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <EmptyState
          icon={MessageSquare}
          title="Nenhuma conversa ainda"
          description="Quando o WhatsApp da clínica estiver conectado, cada mensagem recebida abre uma conversa aqui, já com o histórico do cliente ao lado."
          action={
            <Button variant="secondary" size="md" asChild>
              <Link href="/gestao">Ver configurações</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-dvh">
      {/* Lista de conversas */}
      <aside
        className={cn(
          "w-full shrink-0 overflow-y-auto border-r border-line md:w-[300px]",
          detail ? "hidden md:block" : "block",
        )}
      >
        <div className="border-b border-line px-4 py-3">
          <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Inbox</h1>
          <p className="text-[12px] text-ink-tertiary">
            {conversations.length} {conversations.length === 1 ? "conversa" : "conversas"}
          </p>
        </div>
        <ul className="divide-y divide-line">
          {conversations.map((conversation) => {
            const active = detail?.conversationId === conversation.id;
            return (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => select(conversation.id)}
                  className={cn(
                    "flex w-full gap-2.5 px-4 py-3 text-left transition-colors",
                    active ? "bg-accent-soft" : "hover:bg-surface-sunken",
                  )}
                >
                  <Avatar name={conversation.customerName} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] font-medium text-ink">
                        {conversation.customerName}
                      </span>
                      {conversation.lastMessageAt ? (
                        <span className="shrink-0 text-[11px] text-ink-tertiary">
                          {formatDistanceToNowStrict(new Date(conversation.lastMessageAt), {
                            locale: ptBR,
                          })}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-ink-secondary">
                      {conversation.lastMessageInbound ? "" : "Você: "}
                      {conversation.lastMessagePreview ?? "Sem mensagens"}
                    </span>
                    <span className="mt-1 flex items-center gap-1">
                      <Badge tone={CONTROL[conversation.controlledBy].tone}>
                        {conversation.controlledBy === "ai" ? (
                          <Bot className="size-3" />
                        ) : (
                          <User className="size-3" />
                        )}
                        {CONTROL[conversation.controlledBy].label}
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
      {detail ? (
        <>
          <section className="flex min-w-0 flex-1 flex-col">
            <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
              <div className="min-w-0">
                <h2 className="truncate text-[14px] font-semibold text-ink">{detail.customerName}</h2>
                <p className="text-[12px] text-ink-tertiary">
                  {CHANNEL_LABEL[detail.channel] ?? detail.channel}
                </p>
              </div>
              {detail.controlledBy === "human" ? (
                <Button variant="secondary" size="sm" disabled={pending} onClick={() => setControl("ai")}>
                  <Bot />
                  Devolver para a IA
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  onClick={() => setControl("human")}
                >
                  <User />
                  Assumir conversa
                </Button>
              )}
            </header>

            <div ref={threadRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {detail.messages.map((message) => {
                const outbound = message.direction === "outbound";
                return (
                  <div key={message.id} className={cn("flex", outbound ? "justify-end" : "justify-start")}>
                    <div className="max-w-[76%]">
                      <div
                        className={cn(
                          "rounded-[var(--radius)] px-3 py-2 text-[13px] leading-5",
                          outbound
                            ? "bg-accent text-white"
                            : "border border-line bg-surface-raised text-ink",
                        )}
                      >
                        {message.body}
                      </div>
                      <p
                        className={cn(
                          "mt-1 text-[11px] text-ink-tertiary",
                          outbound ? "text-right" : "text-left",
                        )}
                      >
                        {message.sender === "ai" ? "IA · " : ""}
                        {format(new Date(message.createdAt), "HH:mm")}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-line px-5 py-3">
              <div className="flex items-end gap-2">
                <Textarea
                  rows={2}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
                  }}
                  placeholder="Escreva sua resposta"
                  aria-label="Escrever mensagem"
                  className="min-h-[52px] resize-none"
                />
                <Button variant="primary" size="md" disabled={!draft.trim() || pending} onClick={send}>
                  <Send />
                  Enviar
                </Button>
              </div>
              <p className="mt-1.5 text-[11px] text-ink-tertiary">
                A mensagem fica registrada na conversa. O envio pelo WhatsApp entra quando o canal for
                conectado.
              </p>
            </div>
          </section>

          {/* Contexto do cliente — a razão de não precisar sair do Inbox */}
          <aside className="hidden w-[276px] shrink-0 overflow-y-auto border-l border-line px-4 py-4 lg:block">
            {detail.context ? (
              <>
                <div className="flex items-center gap-2.5">
                  <Avatar name={detail.context.name} size="lg" />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-ink">{detail.context.name}</p>
                    {detail.context.phone ? (
                      <p className="text-[12px] text-ink-tertiary">
                        {formatPhone(detail.context.phone)}
                      </p>
                    ) : null}
                  </div>
                </div>

                <dl className="mt-4 space-y-2 border-t border-line pt-3">
                  <ContextRow label="Atendimentos" value={String(detail.context.visitsCount)} />
                  <ContextRow label="Total gasto" value={formatBRL(detail.context.totalSpentCents)} />
                  <ContextRow
                    label="Última visita"
                    value={
                      detail.context.lastVisitAt
                        ? format(new Date(detail.context.lastVisitAt), "d MMM yyyy", { locale: ptBR })
                        : "Ainda não veio"
                    }
                  />
                </dl>

                {detail.context.nextAppointment ? (
                  <div className="mt-4 rounded-[var(--radius)] border border-line bg-positive-soft/60 px-3 py-2.5">
                    <p className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
                      <CalendarCheck className="size-3.5 text-positive" />
                      Próximo atendimento
                    </p>
                    <p className="mt-1 text-[12px] text-ink-secondary">
                      {format(new Date(detail.context.nextAppointment.startsAt), "d 'de' MMM', 'HH:mm", {
                        locale: ptBR,
                      })}
                    </p>
                    <p className="text-[12px] text-ink-tertiary">
                      {detail.context.nextAppointment.serviceName} ·{" "}
                      {detail.context.nextAppointment.professionalName.split(" ")[0]}
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5">
                    <p className="text-[12px] text-ink-secondary">Sem horário marcado.</p>
                  </div>
                )}

                <div className="mt-4 space-y-2">
                  <Button variant="primary" size="sm" className="w-full" asChild>
                    <Link href="/agenda">Ver horários e agendar</Link>
                  </Button>
                  <Button variant="secondary" size="sm" className="w-full" asChild>
                    <Link href={`/clientes/${detail.context.customerId}`}>Abrir ficha completa</Link>
                  </Button>
                </div>
              </>
            ) : (
              <div className="rounded-[var(--radius)] border border-line bg-surface px-3 py-4">
                <p className="text-[13px] text-ink">Contato ainda não cadastrado</p>
                <p className="mt-1 text-[12px] text-ink-secondary">
                  Ao agendar por esta conversa, o cliente é criado automaticamente.
                </p>
              </div>
            )}
          </aside>
        </>
      ) : null}
    </div>
  );
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[12px] text-ink-tertiary">{label}</dt>
      <dd className="text-[12px] text-ink">{value}</dd>
    </div>
  );
}
