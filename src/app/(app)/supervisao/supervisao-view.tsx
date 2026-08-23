"use client";

import {
  ArrowLeft,
  ArrowRightLeft,
  Clock,
  Headphones,
  Inbox as InboxIcon,
  MessageSquare,
  RefreshCw,
  Search,
  UserCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPhone } from "@/lib/phone";
import { useCurrentMinute } from "@/lib/use-current-minute";
import { cn } from "@/lib/utils";
import { assignConversationAction, refreshSupervisionAction } from "./actions";

/**
 * Painel de supervisão.
 *
 * Feito para ficar aberto numa segunda tela: atualiza sozinho e mostra, em uma
 * olhada, quem está atendendo, quanto cada um segura e quem espera há mais
 * tempo. A fila fica ao lado dos atendentes porque a ação que importa aqui é
 * mover uma coisa para a outra.
 */

type Agent = {
  userId: number;
  name: string;
  role: string;
  activeConversations: number;
  unreadMessages: number;
  lastActivityAt: string | null;
  online: boolean;
  oldestWaitingMinutes: number | null;
};

type QueueItem = {
  conversationId: number;
  customerName: string;
  phone: string | null;
  waitingSince: string | null;
  waitingMinutes: number;
  unreadCount: number;
  lastMessagePreview: string | null;
  lastAssignedUserName: string | null;
};

type Snapshot = {
  agents: Agent[];
  queue: QueueItem[];
  totals: {
    agentsOnline: number;
    agentsTotal: number;
    inService: number;
    unread: number;
    queueSize: number;
    oldestWaitMinutes: number;
    averagePerAgent: number;
  };
};

const ROLE_LABEL: Record<string, string> = {
  owner: "Proprietária",
  admin: "Administração",
  staff: "Recepção",
  professional: "Profissional",
};

/** Espera em linguagem de plantão: minutos até uma hora, depois horas. */
function duracao(minutos: number): string {
  if (minutos < 1) return "agora";
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `${horas}h${minutos % 60 > 0 ? ` ${minutos % 60}min` : ""}`;
  return `${Math.floor(horas / 24)}d`;
}

const ATUALIZA_MS = 20_000;

export function SupervisaoView({ initial }: { initial: Snapshot }) {
  const [dados, setDados] = useState(initial);
  const [busca, setBusca] = useState("");
  const [atualizando, startAtualizando] = useTransition();
  const [atribuindo, setAtribuindo] = useState<number | null>(null);

  // O painel fica aberto por horas; sem atualização periódica ele vira retrato.
  useEffect(() => {
    const timer = setInterval(async () => {
      if (document.hidden) return;
      const novo = await refreshSupervisionAction();
      if (novo) {
        setDados({
          ...novo,
          agents: novo.agents.map((a) => ({ ...a, lastActivityAt: a.lastActivityAt?.toISOString() ?? null })),
          queue: novo.queue.map((q) => ({ ...q, waitingSince: q.waitingSince?.toISOString() ?? null })),
        } as Snapshot);
      }
    }, ATUALIZA_MS);
    return () => clearInterval(timer);
  }, []);

  function recarregar() {
    startAtualizando(async () => {
      const novo = await refreshSupervisionAction();
      if (!novo) {
        toast.error("Não foi possível atualizar.");
        return;
      }
      setDados({
        ...novo,
        agents: novo.agents.map((a) => ({ ...a, lastActivityAt: a.lastActivityAt?.toISOString() ?? null })),
        queue: novo.queue.map((q) => ({ ...q, waitingSince: q.waitingSince?.toISOString() ?? null })),
      } as Snapshot);
    });
  }

  const agentes = busca
    ? dados.agents.filter((a) => a.name.toLowerCase().includes(busca.toLowerCase()))
    : dados.agents;

  const { totals } = dados;

  return (
    <div className="flex h-[calc(100dvh_-_56px_-_env(safe-area-inset-bottom))] flex-col md:h-[calc(100dvh_-_var(--topbar-h,56px))]">
      <header className="shrink-0 border-b border-line bg-surface-raised px-4 py-4 md:px-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="size-9 p-0" asChild>
              <Link href="/inbox" aria-label="Voltar para o inbox">
                <ArrowLeft aria-hidden />
              </Link>
            </Button>
            <span className="bg-brand flex size-10 items-center justify-center rounded-card text-white">
              <Headphones className="size-5" aria-hidden />
            </span>
            <div>
              <h1 className="text-title text-ink">Supervisão</h1>
              <p className="text-caption text-ink-secondary">
                Atualiza sozinho a cada 20 segundos.
              </p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={recarregar} loading={atualizando}>
            <RefreshCw aria-hidden />
            Atualizar
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <Kpi
            icon={Users}
            label="Atendendo agora"
            value={String(totals.agentsOnline)}
            sub={`de ${totals.agentsTotal} na equipe`}
            tone="text-positive"
          />
          <Kpi
            icon={MessageSquare}
            label="Em atendimento"
            value={String(totals.inService)}
            sub={`${totals.unread} sem resposta`}
            tone="text-info"
          />
          <Kpi
            icon={InboxIcon}
            label="Na fila"
            value={String(totals.queueSize)}
            sub={totals.queueSize > 0 ? "esperando alguém" : "ninguém esperando"}
            tone="text-attention"
            alerta={totals.queueSize > 5}
          />
          <Kpi
            icon={Clock}
            label="Espera mais longa"
            value={totals.queueSize > 0 ? duracao(totals.oldestWaitMinutes) : "—"}
            sub="do primeiro da fila"
            tone="text-danger"
            alerta={totals.oldestWaitMinutes > 30}
          />
          <Kpi
            icon={ArrowRightLeft}
            label="Média por pessoa"
            value={String(totals.averagePerAgent)}
            sub="conversas ativas"
            tone="text-accent"
          />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-5">
        <section className="flex min-h-0 flex-col overflow-y-auto border-line lg:col-span-3 lg:border-r">
          <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-4 py-3">
            <h2 className="flex items-center gap-2 text-section text-ink">
              <UserCheck className="size-4 text-accent" aria-hidden />
              Equipe ({dados.agents.length})
            </h2>
            <div className="relative w-full sm:w-[220px]">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-tertiary" aria-hidden />
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pessoa" className="h-9 pl-9" />
            </div>
          </div>

          {agentes.length === 0 ? (
            <p className="px-4 py-8 text-center text-caption text-ink-secondary">Ninguém encontrado.</p>
          ) : (
            <ul className="flex flex-col gap-2 p-4">
              {agentes.map((agente) => (
                <li key={agente.userId}>
                  <AgentCard agent={agente} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex min-h-0 flex-col overflow-y-auto lg:col-span-2">
          <div className="sticky top-0 z-10 border-b border-line bg-surface px-4 py-3">
            <h2 className="flex items-center gap-2 text-section text-ink">
              <InboxIcon className="size-4 text-attention" aria-hidden />
              Fila ({dados.queue.length})
            </h2>
          </div>

          {dados.queue.length === 0 ? (
            <p className="px-4 py-8 text-center text-caption text-ink-secondary">
              Ninguém esperando. É o estado que se quer ver aqui.
            </p>
          ) : (
            <ul className="flex flex-col gap-2 p-4">
              {dados.queue.map((item) => (
                <li key={item.conversationId} className="rounded-card border border-line bg-surface-raised p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar name={item.customerName} size="md" />
                      <div className="min-w-0">
                        <p className="truncate text-label text-ink">{item.customerName}</p>
                        {item.phone ? (
                          <p className="truncate text-caption text-ink-secondary tabular">{formatPhone(item.phone)}</p>
                        ) : null}
                      </div>
                    </div>
                    <Badge tone={item.waitingMinutes > 30 ? "danger" : item.waitingMinutes > 10 ? "attention" : "neutral"}>
                      <Clock className="size-3" aria-hidden />
                      {duracao(item.waitingMinutes)}
                    </Badge>
                  </div>

                  {item.lastMessagePreview ? (
                    <p className="mt-2 line-clamp-2 text-caption text-ink-secondary">{item.lastMessagePreview}</p>
                  ) : null}

                  {item.lastAssignedUserName ? (
                    <p className="mt-1 text-meta text-ink-tertiary">
                      Atendida antes por {item.lastAssignedUserName.split(" ")[0]}
                    </p>
                  ) : null}

                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <select
                      aria-label={`Entregar a conversa de ${item.customerName} para alguém`}
                      disabled={atribuindo === item.conversationId}
                      value=""
                      onChange={async (event) => {
                        const userId = Number(event.target.value);
                        if (!userId) return;
                        setAtribuindo(item.conversationId);
                        const resultado = await assignConversationAction({
                          conversationId: item.conversationId,
                          userId,
                        });
                        setAtribuindo(null);
                        if (!resultado.ok) {
                          toast.error(resultado.error);
                          return;
                        }
                        toast.success("Conversa entregue");
                        recarregar();
                      }}
                      className="h-9 flex-1 rounded-control border border-line bg-surface px-2 text-caption text-ink"
                    >
                      <option value="">Entregar para…</option>
                      {dados.agents.map((agente) => (
                        <option key={agente.userId} value={agente.userId}>
                          {agente.name} ({agente.activeConversations})
                        </option>
                      ))}
                    </select>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/inbox?conversa=${item.conversationId}`}>Abrir</Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  alerta,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  sub: string;
  tone: string;
  alerta?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-card border bg-surface-raised px-3 py-2.5",
        alerta ? "border-attention" : "border-line",
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon className={cn("size-4 shrink-0", tone)} aria-hidden />
        <span className="truncate text-meta font-medium tracking-wide text-ink-secondary uppercase">{label}</span>
      </div>
      <p className="mt-1 text-title text-ink tabular">{value}</p>
      <p className="truncate text-caption text-ink-secondary">{sub}</p>
    </div>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  // O hook devolve o minuto em epoch (null no servidor), o que mantém o texto
  // vivo sem ler o relógio durante o render.
  const minutoAtual = useCurrentMinute();
  const sobrecarregado = agent.activeConversations >= 8;
  const desdeUltimaResposta =
    minutoAtual !== null && agent.lastActivityAt
      ? Math.max(0, minutoAtual - Math.floor(new Date(agent.lastActivityAt).getTime() / 60_000))
      : null;

  return (
    <div className="flex items-center gap-3 rounded-card border border-line bg-surface-raised p-3">
      <div className="relative shrink-0">
        <Avatar name={agent.name} size="lg" />
        <span
          title={agent.online ? "Respondeu nos últimos minutos" : "Sem resposta recente"}
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full ring-2 ring-surface-raised",
            agent.online ? "bg-positive" : "bg-ink-tertiary/40",
          )}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-label text-ink">{agent.name}</p>
          <Badge tone={agent.online ? "positive" : "neutral"}>
            {agent.online ? "Atendendo" : "Parado"}
          </Badge>
          {sobrecarregado ? <Badge tone="attention">Carga alta</Badge> : null}
        </div>
        <p className="mt-0.5 text-caption text-ink-secondary">
          {ROLE_LABEL[agent.role] ?? agent.role}
          {desdeUltimaResposta !== null
            ? ` · respondeu ${duracao(desdeUltimaResposta)} atrás`
            : " · ainda não respondeu ninguém"}
        </p>
      </div>

      <div className="flex shrink-0 gap-4 text-center">
        <div>
          <p className="text-card text-ink tabular">{agent.activeConversations}</p>
          <p className="text-meta text-ink-secondary">ativas</p>
        </div>
        <div>
          <p className={cn("text-card tabular", agent.unreadMessages > 0 ? "text-danger" : "text-ink")}>
            {agent.unreadMessages}
          </p>
          <p className="text-meta text-ink-secondary">sem ler</p>
        </div>
      </div>
    </div>
  );
}
