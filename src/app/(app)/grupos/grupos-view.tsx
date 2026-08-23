"use client";

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Check,
  Copy,
  Crown,
  Link2,
  Lock,
  LogOut,
  Megaphone,
  MessageSquare,
  Pin,
  Plus,
  Radar,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { copyToClipboard } from "@/lib/clipboard";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import {
  classifyGroupAction,
  createGroupAction,
  getGroupAction,
  groupThreadAction,
  joinGroupAction,
  leaveGroupAction,
  listGroupInboxAction,
  pinGroupAction,
  resetInviteAction,
  sendToGroupAction,
  summarizeGroupAction,
  updateGroupAction,
  updateParticipantsAction,
} from "./actions";

/**
 * Caixa de entrada de grupos.
 *
 * Grupo não é conversa de atendimento: ninguém "assume" um grupo nem o
 * resolve. O que se faz com grupo é decidir se ele merece atenção, ver o que
 * foi dito e responder quando for o caso. Por isso a tela tem classificação no
 * lugar de fila, e um resumo no lugar da promessa de ler tudo.
 */

type Classification = "none" | "radar" | "opportunity" | "private";
type Filtro = Classification | "all";

type GroupItem = {
  jid: string;
  name: string;
  description: string | null;
  participantCount: number;
  classification: Classification;
  pinned: boolean;
  conversationId: number | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageFromMe: boolean;
  unreadCount: number;
  awaitingReply: boolean;
};

type Participant = {
  jid: string;
  phone: string | null;
  displayName: string | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
};

type GroupDetail = {
  jid: string;
  name: string;
  description: string | null;
  ownerPhone: string | null;
  participants: Participant[];
  participantCount: number;
  onlyAdminsSend: boolean;
  onlyAdminsEdit: boolean;
  requiresApproval: boolean;
  createdAt: string | null;
  inviteLink?: string | null;
};

type ThreadMessage = {
  id: number;
  body: string;
  senderName: string | null;
  direction: "inbound" | "outbound";
  messageType: string;
  mediaUrl: string | null;
  audioTranscription: string | null;
  createdAt: string;
};

/** As três gavetas que o negócio usa, mais o "sem classificar". */
const CLASSIFICACOES: Array<{ id: Classification; label: string; icon: typeof Radar; tone: string }> = [
  { id: "radar", label: "Radar", icon: Radar, tone: "text-accent" },
  { id: "opportunity", label: "Oportunidade", icon: Megaphone, tone: "text-positive" },
  { id: "private", label: "Particular", icon: Lock, tone: "text-attention" },
];

const PAGE_SIZE = 30;

function tempoRelativo(iso: string): string {
  const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutos < 1) return "agora";
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `${horas}h`;
  const dias = Math.round(horas / 24);
  if (dias < 7) return `${dias}d`;
  return format(new Date(iso), "d MMM", { locale: ptBR });
}

export function GruposView({ connected, canManage }: { connected: boolean; canManage: boolean }) {
  const [items, setItems] = useState<GroupItem[]>([]);
  const [counts, setCounts] = useState<Record<Filtro, number>>({
    all: 0,
    none: 0,
    radar: 0,
    opportunity: 0,
    private: 0,
  });
  const [filtro, setFiltro] = useState<Filtro>("all");
  const [busca, setBusca] = useState("");
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [carregando, setCarregando] = useState(connected);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [entrando, setEntrando] = useState(false);
  const pedido = useRef(0);

  const carregar = useCallback(
    async (proximoFiltro: Filtro, termo: string, proximoOffset: number) => {
      const chamada = ++pedido.current;
      setCarregando(true);
      const resultado = await listGroupInboxAction({
        classification: proximoFiltro,
        search: termo || undefined,
        offset: proximoOffset,
        limit: PAGE_SIZE,
      });
      if (chamada !== pedido.current) return;
      setCarregando(false);
      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }
      setItems(resultado.data.items as GroupItem[]);
      setTotal(resultado.data.total);
      setCounts(resultado.data.counts as Record<Filtro, number>);
      setOffset(proximoOffset);
    },
    [],
  );

  useEffect(() => {
    if (!connected) return;
    const timer = setTimeout(() => void carregar(filtro, busca, 0), busca ? 400 : 0);
    return () => clearTimeout(timer);
  }, [busca, filtro, connected, carregar]);

  if (!connected) {
    return (
      <div className="mx-auto w-full max-w-[820px] px-4 py-10">
        <EmptyState
          icon={Users}
          title="Conecte o WhatsApp para ver seus grupos"
          description="A lista vem direto do aparelho conectado. Nada é copiado para cá, então o que você vê é sempre o estado real."
          action={
            <Button variant="secondary" size="md" asChild>
              <Link href="/whatsapp">Ir para a conexão</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const grupoSelecionado = items.find((g) => g.jid === selecionado) ?? null;

  return (
    <div className="flex h-[calc(100dvh_-_56px_-_env(safe-area-inset-bottom))] md:h-[calc(100dvh_-_var(--topbar-h,56px))]">
      <aside
        aria-label="Grupos"
        className={cn(
          "w-full shrink-0 flex-col overflow-y-auto border-r border-line bg-surface-raised md:flex md:w-[340px] lg:w-[380px]",
          selecionado == null ? "flex" : "hidden",
        )}
      >
        <div className="sticky top-0 z-10 flex flex-col gap-2 border-b border-line bg-surface-raised px-3 py-3">
          <div className="flex items-center gap-2">
            <span className="bg-brand flex size-8 shrink-0 items-center justify-center rounded-control text-white">
              <Users className="size-4" aria-hidden />
            </span>
            <h1 className="min-w-0 flex-1 truncate text-card text-ink">Grupos</h1>
            {canManage ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => setEntrando(true)} title="Entrar por convite">
                  <Link2 aria-hidden />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setCriando(true)} title="Criar grupo">
                  <Plus aria-hidden />
                </Button>
              </>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              title="Recarregar do WhatsApp"
              loading={carregando}
              onClick={() => carregar(filtro, busca, 0)}
            >
              <RefreshCw aria-hidden />
            </Button>
          </div>

          {/* Classificação como filtro: com centenas de grupos, é o que separa
              o que merece atenção do resto. */}
          <div className="grid grid-cols-4 gap-1">
            {[...CLASSIFICACOES, { id: "all" as const, label: "Todos", icon: Users, tone: "text-ink-secondary" }].map(
              (opcao) => {
                const ativo = filtro === opcao.id;
                const Icone = opcao.icon;
                const quantidade = counts[opcao.id as Filtro] ?? 0;
                return (
                  <button
                    key={opcao.id}
                    type="button"
                    onClick={() => setFiltro(opcao.id as Filtro)}
                    className={cn(
                      "flex min-w-0 flex-col items-center gap-0.5 rounded-control border px-1 py-1.5 text-meta font-medium transition-colors",
                      ativo
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-line text-ink-secondary hover:bg-surface-sunken",
                    )}
                  >
                    <Icone className={cn("size-4 shrink-0", ativo ? "text-accent" : opcao.tone)} aria-hidden />
                    <span className="max-w-full truncate leading-tight">{opcao.label}</span>
                    <span className="tabular">{quantidade}</span>
                  </button>
                );
              },
            )}
          </div>

          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-tertiary"
              aria-hidden
            />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar grupo"
              className="pl-9"
            />
          </div>
        </div>

        {carregando ? (
          <ul className="flex flex-col gap-1 p-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <li key={i} className="h-[72px] animate-pulse rounded-card bg-surface-sunken" />
            ))}
          </ul>
        ) : items.length === 0 ? (
          <p className="px-4 py-8 text-center text-caption text-ink-secondary">
            {busca ? "Nenhum grupo com esse nome." : "Nenhum grupo nesta gaveta."}
          </p>
        ) : (
          <ul>
            {items.map((grupo) => (
              <li key={grupo.jid} className="border-b border-line">
                <GroupRow
                  group={grupo}
                  active={grupo.jid === selecionado}
                  onOpen={() => setSelecionado(grupo.jid)}
                />
              </li>
            ))}
          </ul>
        )}

        {filtro === "all" && total > PAGE_SIZE ? (
          <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={offset === 0 || carregando}
              onClick={() => carregar(filtro, busca, Math.max(0, offset - PAGE_SIZE))}
            >
              Anterior
            </Button>
            <span className="text-caption text-ink-secondary tabular">
              {Math.floor(offset / PAGE_SIZE) + 1} de {Math.max(1, Math.ceil(total / PAGE_SIZE))}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={offset + PAGE_SIZE >= total || carregando}
              onClick={() => carregar(filtro, busca, offset + PAGE_SIZE)}
            >
              Próxima
            </Button>
          </div>
        ) : null}
      </aside>

      <section className={cn("min-w-0 flex-1 flex-col bg-surface md:flex", selecionado == null ? "hidden" : "flex")}>
        {grupoSelecionado ? (
          <GroupWorkspace
            key={grupoSelecionado.jid}
            group={grupoSelecionado}
            canManage={canManage}
            onBack={() => setSelecionado(null)}
            onChanged={() => carregar(filtro, busca, offset)}
            onLeft={() => {
              setSelecionado(null);
              carregar(filtro, busca, 0);
            }}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={MessageSquare}
              title="Escolha um grupo"
              description="Veja o que foi dito, quem está dentro e o que precisa de resposta."
            />
          </div>
        )}
      </section>

      <Sheet open={criando} onOpenChange={setCriando}>
        <SheetContent title="Novo grupo" className="w-full sm:max-w-[480px]">
          <CreateGroup
            onCreated={() => {
              setCriando(false);
              carregar(filtro, busca, 0);
            }}
          />
        </SheetContent>
      </Sheet>

      <Sheet open={entrando} onOpenChange={setEntrando}>
        <SheetContent title="Entrar por convite" className="w-full sm:max-w-[480px]">
          <JoinGroup
            onJoined={() => {
              setEntrando(false);
              carregar(filtro, busca, 0);
            }}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Linha da lista: nome, tamanho, o que foi dito por último e o que pede ação. */
function GroupRow({
  group,
  active,
  onOpen,
}: {
  group: GroupItem;
  active: boolean;
  onOpen: () => void;
}) {
  const classe = CLASSIFICACOES.find((c) => c.id === group.classification);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full items-start gap-3 border-l-[3px] px-3 py-3 text-left transition-colors",
        "border-l-transparent hover:bg-surface-sunken",
        active && "border-l-accent bg-accent-soft hover:bg-accent-soft",
      )}
    >
      <span className="relative shrink-0">
        <Avatar name={group.name} size="lg" />
        <span className="absolute -right-0.5 -bottom-0.5 flex size-[18px] items-center justify-center rounded-full bg-[#25D366] ring-2 ring-surface-raised">
          <Users className="size-2.5 text-white" aria-hidden />
        </span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1">
            {group.pinned ? <Pin className="size-3 shrink-0 -rotate-45 text-accent" aria-hidden /> : null}
            <span className={cn("truncate text-label text-ink", group.unreadCount > 0 && "font-semibold")}>
              {group.name}
            </span>
          </span>
          {group.lastMessageAt ? (
            <span suppressHydrationWarning className="shrink-0 text-meta text-ink-secondary tabular">
              {tempoRelativo(group.lastMessageAt)}
            </span>
          ) : null}
        </span>

        <span className="mt-0.5 flex items-center gap-1.5">
          {group.participantCount > 0 ? (
            <span className="shrink-0 text-caption text-ink-tertiary tabular">{group.participantCount}</span>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-caption text-ink-secondary">
            {group.lastMessagePreview
              ? `${group.lastMessageFromMe ? "Você: " : ""}${group.lastMessagePreview}`
              : (group.description ?? "Sem mensagens por aqui")}
          </span>
          {group.unreadCount > 0 ? (
            <span className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white tabular">
              {group.unreadCount > 99 ? "99+" : group.unreadCount}
            </span>
          ) : null}
        </span>

        <span className="mt-1 flex flex-wrap items-center gap-1">
          {group.awaitingReply ? <Badge tone="attention">Sem resposta</Badge> : null}
          {classe ? (
            <Badge tone={group.classification === "opportunity" ? "positive" : "neutral"}>
              <classe.icon className="size-3" aria-hidden />
              {classe.label}
            </Badge>
          ) : null}
        </span>
      </span>
    </button>
  );
}

type Aba = "conversa" | "membros" | "ajustes";

/**
 * O grupo aberto.
 *
 * O cabeçalho responde "o que é este grupo", a barra de classificação decide
 * o quanto ele importa, e as abas separam três perguntas diferentes: o que foi
 * dito, quem está dentro, e como o grupo está configurado.
 */
function GroupWorkspace({
  group,
  canManage,
  onBack,
  onChanged,
  onLeft,
}: {
  group: GroupItem;
  canManage: boolean;
  onBack: () => void;
  onChanged: () => void;
  onLeft: () => void;
}) {
  const [aba, setAba] = useState<Aba>("conversa");
  const [detalhe, setDetalhe] = useState<GroupDetail | null>(null);
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [resumo, setResumo] = useState<string | null>(null);
  const [carregandoDetalhe, setCarregandoDetalhe] = useState(true);
  const [resumindo, startResumindo] = useTransition();
  const [classificando, startClassificando] = useTransition();

  // O componente é remontado a cada grupo (key={jid}), então o estado já nasce
  // carregando: mudar isso dentro do efeito seria render em cascata à toa.
  useEffect(() => {
    let ativo = true;
    void Promise.all([getGroupAction(group.jid), groupThreadAction(group.jid)]).then(([info, conversa]) => {
      if (!ativo) return;
      setCarregandoDetalhe(false);
      if (info.ok) setDetalhe(info.data as GroupDetail);
      else toast.error(info.error);
      if (conversa.ok) setThread(conversa.data.messages as ThreadMessage[]);
    });
    return () => {
      ativo = false;
    };
  }, [group.jid]);

  function classificar(classification: Classification) {
    startClassificando(async () => {
      const resultado = await classifyGroupAction({
        jid: group.jid,
        // Tocar de novo na mesma gaveta tira o grupo dela.
        classification: group.classification === classification ? "none" : classification,
      });
      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }
      onChanged();
    });
  }

  function resumir() {
    startResumindo(async () => {
      const resultado = await summarizeGroupAction({ jid: group.jid, hours: 48 });
      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }
      setResumo(resultado.data.summary);
      toast.success(`Resumo de ${resultado.data.messageCount} mensagens`);
    });
  }

  return (
    <>
      <header className="shrink-0 border-b border-line bg-surface-raised">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 md:px-5">
          <Button variant="ghost" size="sm" className="md:hidden" onClick={onBack}>
            Voltar
          </Button>
          <Avatar name={group.name} size="md" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-card text-ink">{group.name}</h2>
            <p className="flex items-center gap-1.5 text-caption text-ink-secondary">
              <Users className="size-3 shrink-0" aria-hidden />
              <span className="tabular">{detalhe?.participantCount ?? group.participantCount}</span>
              {group.awaitingReply ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="text-attention">esperando resposta</span>
                </>
              ) : null}
            </p>
          </div>

          <Button
            variant="ghost"
            size="sm"
            title={group.pinned ? "Desafixar" : "Fixar no topo"}
            onClick={async () => {
              const resultado = await pinGroupAction({ jid: group.jid, pinned: !group.pinned });
              if (!resultado.ok) toast.error(resultado.error);
              else onChanged();
            }}
          >
            <Pin className={cn("size-4", group.pinned && "-rotate-45 text-accent")} aria-hidden />
          </Button>
          <Button variant="secondary" size="sm" loading={resumindo} onClick={resumir}>
            <Sparkles aria-hidden />
            <span className="hidden sm:inline">Resumir 48h</span>
          </Button>
        </div>

        {/* Classificação: a decisão que faz uma lista de centenas virar trabalho */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2 md:px-5">
          <span className="mr-1 text-meta tracking-wide text-ink-secondary uppercase">Classificação</span>
          {CLASSIFICACOES.map((opcao) => {
            const ativo = group.classification === opcao.id;
            const Icone = opcao.icon;
            return (
              <button
                key={opcao.id}
                type="button"
                disabled={classificando}
                onClick={() => classificar(opcao.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-caption font-medium transition-colors",
                  ativo
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line text-ink-secondary hover:bg-surface-sunken hover:text-ink",
                )}
              >
                {ativo ? <Check className="size-3" aria-hidden /> : <Icone className="size-3" aria-hidden />}
                {opcao.label}
              </button>
            );
          })}
        </div>

        <div className="flex gap-1 border-t border-line px-3 md:px-5" role="tablist">
          {(
            [
              ["conversa", "Conversa"],
              ["membros", `Membros (${detalhe?.participantCount ?? group.participantCount})`],
              ["ajustes", "Ajustes"],
            ] as Array<[Aba, string]>
          ).map(([id, rotulo]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={aba === id}
              onClick={() => setAba(id)}
              className={cn(
                "border-b-2 px-3 py-2 text-label font-medium transition-colors",
                aba === id
                  ? "border-accent text-accent"
                  : "border-transparent text-ink-secondary hover:text-ink",
              )}
            >
              {rotulo}
            </button>
          ))}
        </div>
      </header>

      {resumo ? (
        <div className="shrink-0 border-b border-line bg-accent-soft px-3 py-2.5 md:px-5">
          <p className="flex items-center gap-1.5 text-caption font-medium text-accent">
            <Sparkles className="size-3.5" aria-hidden />
            Resumo das últimas 48 horas
          </p>
          <p className="mt-1 whitespace-pre-wrap text-body text-ink">{resumo}</p>
          <button type="button" onClick={() => setResumo(null)} className="mt-1 text-caption text-ink-secondary">
            Fechar
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {aba === "conversa" ? (
          <GroupThread jid={group.jid} messages={thread} onSent={() => void groupThreadAction(group.jid).then((r) => {
            if (r.ok) setThread(r.data.messages as ThreadMessage[]);
          })} />
        ) : null}

        {aba === "membros" ? (
          <GroupMembers
            group={group}
            detail={detalhe}
            loading={carregandoDetalhe}
            canManage={canManage}
            onUpdated={setDetalhe}
          />
        ) : null}

        {aba === "ajustes" && detalhe ? (
          <GroupSettings group={detalhe} canManage={canManage} onUpdated={setDetalhe} onLeft={onLeft} />
        ) : null}
      </div>
    </>
  );
}

/** Conversa do grupo: quem falou aparece porque em grupo isso é metade da mensagem. */
function GroupThread({
  jid,
  messages,
  onSent,
}: {
  jid: string;
  messages: ThreadMessage[];
  onSent: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [enviando, startEnviando] = useTransition();
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  function enviar() {
    const corpo = texto.trim();
    if (!corpo) return;
    setTexto("");
    startEnviando(async () => {
      const resultado = await sendToGroupAction({ jid, body: corpo });
      if (!resultado.ok) {
        toast.error(resultado.error);
        setTexto(corpo);
        return;
      }
      onSent();
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-3 py-4 md:px-6">
        {messages.length === 0 ? (
          <p className="mx-auto max-w-[560px] rounded-card bg-surface-sunken px-4 py-6 text-center text-caption text-ink-secondary">
            Nenhuma mensagem deste grupo chegou por aqui ainda. Elas aparecem conforme o grupo se movimenta.
          </p>
        ) : (
          <div className="mx-auto flex max-w-[680px] flex-col gap-2">
            {messages.map((mensagem) => {
              const nossa = mensagem.direction === "outbound";
              return (
                <div key={mensagem.id} className={cn("flex flex-col", nossa ? "items-end" : "items-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-card border px-3 py-2 text-body text-ink [overflow-wrap:anywhere]",
                      nossa ? "border-line-strong bg-surface-sunken" : "border-line bg-surface-raised",
                    )}
                  >
                    {!nossa && mensagem.senderName ? (
                      <span className="mb-0.5 block text-caption font-medium text-accent">{mensagem.senderName}</span>
                    ) : null}
                    <span className="block whitespace-pre-wrap">
                      {mensagem.audioTranscription || mensagem.body || `[${mensagem.messageType}]`}
                    </span>
                  </div>
                  <span suppressHydrationWarning className="mt-0.5 px-1 text-meta text-ink-secondary">
                    {format(new Date(mensagem.createdAt), "dd/MM HH:mm", { locale: ptBR })}
                  </span>
                </div>
              );
            })}
            <div ref={fim} />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line bg-surface-raised px-3 py-2.5 md:px-6">
        <div className="mx-auto flex max-w-[680px] items-end gap-2">
          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                enviar();
              }
            }}
            rows={1}
            placeholder="Mensagem para o grupo"
            className="max-h-32 min-h-11 flex-1 resize-none"
          />
          <Button size="md" className="h-11 shrink-0" loading={enviando} disabled={!texto.trim()} onClick={enviar}>
            <Send aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}

function GroupMembers({
  group,
  detail,
  loading,
  canManage,
  onUpdated,
}: {
  group: GroupItem;
  detail: GroupDetail | null;
  loading: boolean;
  canManage: boolean;
  onUpdated: (next: GroupDetail) => void;
}) {
  const [novo, setNovo] = useState("");
  const [busy, startBusy] = useTransition();

  function agir(acao: "add" | "remove" | "promote" | "demote", participants: string[], sucesso: string) {
    startBusy(async () => {
      const resultado = await updateParticipantsAction({ groupJid: group.jid, action: acao, participants });
      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }
      onUpdated(resultado.data as GroupDetail);
      toast.success(sucesso);
    });
  }

  if (loading) {
    return (
      <ul className="flex flex-col gap-1.5 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i} className="h-12 animate-pulse rounded-control bg-surface-sunken" />
        ))}
      </ul>
    );
  }

  const participantes = detail?.participants ?? [];

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-4">
      {canManage ? (
        <div className="mb-3 flex items-end gap-2">
          <div className="flex-1">
            <Field label="Adicionar pelo telefone" hint="Com país e DDD, por exemplo 5511999998888.">
              <Input
                value={novo}
                onChange={(e) => setNovo(e.target.value)}
                placeholder="5511999998888"
                inputMode="numeric"
              />
            </Field>
          </div>
          <Button
            size="md"
            loading={busy}
            disabled={novo.replace(/\D/g, "").length < 12}
            onClick={() => {
              agir("add", [novo.replace(/\D/g, "")], "Convite enviado");
              setNovo("");
            }}
          >
            <UserPlus aria-hidden />
          </Button>
        </div>
      ) : null}

      {participantes.length === 0 ? (
        <p className="rounded-control bg-surface-sunken px-3 py-6 text-center text-caption text-ink-secondary">
          A lista de participantes não veio nesta consulta.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {participantes.map((pessoa) => (
            <li key={pessoa.jid} className="flex items-center gap-2 py-2.5">
              <Avatar name={pessoa.displayName || pessoa.phone || "?"} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-label text-ink">
                  {pessoa.displayName || (pessoa.phone ? formatPhone(pessoa.phone) : "Participante")}
                </span>
                {pessoa.displayName && pessoa.phone ? (
                  <span className="block truncate text-caption text-ink-secondary tabular">
                    {formatPhone(pessoa.phone)}
                  </span>
                ) : null}
              </span>
              {pessoa.isSuperAdmin ? (
                <Badge tone="accent">
                  <Crown className="size-3" aria-hidden />
                  Dono
                </Badge>
              ) : pessoa.isAdmin ? (
                <Badge tone="info">
                  <ShieldCheck className="size-3" aria-hidden />
                  Admin
                </Badge>
              ) : null}
              {canManage && !pessoa.isSuperAdmin ? (
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy}
                    title={pessoa.isAdmin ? "Rebaixar" : "Tornar administrador"}
                    onClick={() =>
                      agir(
                        pessoa.isAdmin ? "demote" : "promote",
                        [pessoa.jid],
                        pessoa.isAdmin ? "Não é mais administrador" : "Agora é administrador",
                      )
                    }
                  >
                    <ShieldCheck aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy}
                    title="Remover do grupo"
                    onClick={() => {
                      if (!confirm(`Remover ${pessoa.displayName || pessoa.phone} do grupo?`)) return;
                      agir("remove", [pessoa.jid], "Participante removido");
                    }}
                  >
                    <UserMinus aria-hidden />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GroupSettings({
  group,
  canManage,
  onUpdated,
  onLeft,
}: {
  group: GroupDetail;
  canManage: boolean;
  onUpdated: (next: GroupDetail) => void;
  onLeft: () => void;
}) {
  const [busy, startBusy] = useTransition();
  const [copiado, setCopiado] = useState(false);

  function salvar(patch: Record<string, unknown>, sucesso: string) {
    startBusy(async () => {
      const resultado = await updateGroupAction({ groupJid: group.jid, ...patch });
      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }
      onUpdated(resultado.data as GroupDetail);
      toast.success(sucesso);
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 py-4">
      <Field label="Nome do grupo">
        <Input
          defaultValue={group.name}
          disabled={!canManage}
          onBlur={(e) => {
            const valor = e.target.value.trim();
            if (!valor || valor === group.name) return;
            salvar({ name: valor }, "Nome atualizado");
          }}
        />
      </Field>

      <Field label="Descrição">
        <Textarea
          defaultValue={group.description ?? ""}
          rows={4}
          disabled={!canManage}
          onBlur={(e) => {
            const valor = e.target.value.trim();
            if (valor === (group.description ?? "")) return;
            salvar({ description: valor }, "Descrição atualizada");
          }}
        />
      </Field>

      <div className="flex flex-col gap-1 border-t border-line pt-3">
        <GroupToggle
          label="Só administradores enviam mensagem"
          hint="Use para avisos, quando o grupo não é para conversa."
          checked={group.onlyAdminsSend}
          disabled={!canManage || busy}
          onChange={(v) => salvar({ onlyAdminsSend: v }, "Permissão atualizada")}
        />
        <GroupToggle
          label="Só administradores editam o grupo"
          hint="Nome, foto e descrição ficam travados para os demais."
          checked={group.onlyAdminsEdit}
          disabled={!canManage || busy}
          onChange={(v) => salvar({ onlyAdminsEdit: v }, "Permissão atualizada")}
        />
        <GroupToggle
          label="Aprovar quem entra pelo link"
          hint="Cada pedido precisa de aprovação de um administrador."
          checked={group.requiresApproval}
          disabled={!canManage || busy}
          onChange={(v) => salvar({ requiresApproval: v }, "Permissão atualizada")}
        />
      </div>

      <div className="border-t border-line pt-3">
        <p className="text-label text-ink">Link de convite</p>
        {group.inviteLink ? (
          <div className="mt-1.5 flex items-center gap-2 rounded-control bg-surface-sunken px-3 py-2">
            <input
              readOnly
              value={group.inviteLink}
              aria-label="Link de convite do grupo"
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 truncate bg-transparent text-caption text-ink outline-none"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                const ok = await copyToClipboard(group.inviteLink ?? "");
                if (!ok) {
                  toast.error("Não consegui copiar. Selecione o link e copie manualmente.");
                  return;
                }
                setCopiado(true);
                setTimeout(() => setCopiado(false), 1600);
                toast.success("Link copiado");
              }}
            >
              {copiado ? <Check aria-hidden /> : <Copy aria-hidden />}
            </Button>
          </div>
        ) : (
          <p className="mt-1 text-caption text-ink-secondary">
            Este grupo não expôs link de convite. Normalmente é falta de permissão de administrador.
          </p>
        )}
        {canManage ? (
          <button
            type="button"
            className="mt-2 flex items-center gap-1.5 text-caption text-ink-secondary hover:text-ink"
            onClick={() => {
              if (!confirm("Gerar um link novo? Quem tiver o link antigo perde o acesso.")) return;
              startBusy(async () => {
                const resultado = await resetInviteAction(group.jid);
                if (!resultado.ok) {
                  toast.error(resultado.error);
                  return;
                }
                onUpdated({ ...group, inviteLink: resultado.data });
                toast.success("Link renovado");
              });
            }}
          >
            <RotateCcw className="size-3.5" aria-hidden />
            Gerar link novo
          </button>
        ) : null}
      </div>

      {canManage ? (
        <div className="border-t border-line pt-3">
          <Button
            variant="ghost"
            size="md"
            className="text-danger"
            loading={busy}
            onClick={() => {
              if (!confirm(`Sair de "${group.name}"? Para voltar será preciso um novo convite.`)) return;
              startBusy(async () => {
                const resultado = await leaveGroupAction(group.jid);
                if (!resultado.ok) {
                  toast.error(resultado.error);
                  return;
                }
                toast.success("Você saiu do grupo");
                onLeft();
              });
            }}
          >
            <LogOut aria-hidden />
            Sair do grupo
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function GroupToggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={cn("flex items-start justify-between gap-3 py-2", disabled ? "opacity-60" : "cursor-pointer")}>
      <span className="min-w-0">
        <span className="block text-label text-ink">{label}</span>
        <span className="block text-caption text-ink-secondary">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-5 shrink-0 accent-[var(--accent)]"
      />
    </label>
  );
}

function CreateGroup({ onCreated }: { onCreated: () => void }) {
  const [nome, setNome] = useState("");
  const [numeros, setNumeros] = useState("");
  const [busy, startBusy] = useTransition();

  const lista = numeros
    .split(/[\n,;]+/)
    .map((n) => n.replace(/\D/g, ""))
    .filter((n) => n.length >= 12);

  return (
    <div className="flex h-full flex-col">
      <p className="pb-3 text-caption text-ink-secondary">
        O grupo é criado no aparelho conectado, com ele como administrador.
      </p>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
        <Field label="Nome do grupo">
          <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} placeholder="Clientes VIP" />
        </Field>
        <Field label="Participantes" hint="Um número por linha, com país e DDD.">
          <Textarea
            value={numeros}
            onChange={(e) => setNumeros(e.target.value)}
            rows={6}
            placeholder={"5511999998888\n5511988887777"}
          />
        </Field>
        <p className="text-caption text-ink-secondary">
          {lista.length} {lista.length === 1 ? "número válido" : "números válidos"}
        </p>
        <Button
          size="md"
          loading={busy}
          disabled={!nome.trim() || lista.length === 0}
          onClick={() =>
            startBusy(async () => {
              const resultado = await createGroupAction({ name: nome.trim(), participants: lista });
              if (!resultado.ok) {
                toast.error(resultado.error);
                return;
              }
              toast.success("Grupo criado");
              onCreated();
            })
          }
        >
          Criar grupo
        </Button>
        <p className="flex items-start gap-1.5 text-caption text-ink-secondary">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Quem tem privacidade restrita não entra direto: recebe convite e decide.
        </p>
      </div>
    </div>
  );
}

function JoinGroup({ onJoined }: { onJoined: () => void }) {
  const [codigo, setCodigo] = useState("");
  const [busy, startBusy] = useTransition();

  return (
    <div className="flex h-full flex-col">
      <p className="pb-3 text-caption text-ink-secondary">Cole o link ou o código do convite.</p>
      <div className="flex flex-1 flex-col gap-3">
        <Field label="Link ou código">
          <Input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="https://chat.whatsapp.com/…" />
        </Field>
        <Button
          size="md"
          loading={busy}
          disabled={codigo.trim().length < 4}
          onClick={() =>
            startBusy(async () => {
              const resultado = await joinGroupAction(codigo.trim());
              if (!resultado.ok) {
                toast.error(resultado.error);
                return;
              }
              toast.success("Você entrou no grupo");
              onJoined();
            })
          }
        >
          Entrar
        </Button>
      </div>
    </div>
  );
}
