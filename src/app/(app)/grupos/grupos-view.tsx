"use client";

import {
  BarChart3,
  CalendarClock,
  Check,
  Contact,
  Copy,
  Crown,
  FileText,
  ImageDown,
  Image as ImageIcon,
  MapPin,
  Mic,
  Link2,
  Lock,
  LogOut,
  Megaphone,
  MessageSquare,
  Paperclip,
  Pin,
  Plus,
  Radar,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Smile,
  Sparkles,
  TriangleAlert,
  UserMinus,
  UserPlus,
  Users,
  Video,
  X,
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
import { useFuso } from "@/lib/fuso";
import { formatTz } from "@/lib/tz";
import { cn } from "@/lib/utils";
import {
  classifyGroupAction,
  createGroupAction,
  getGroupAction,
  groupThreadAction,
  joinGroupAction,
  leaveGroupAction,
  cancelScheduledAction,
  listGroupInboxAction,
  listScheduledAction,
  pinGroupAction,
  scheduleGroupMessageAction,
  type ScheduledView,
  resetInviteAction,
  sendToGroupAction,
  summarizeGroupAction,
  updateGroupAction,
  updateParticipantsAction,
} from "./actions";
import { loadMediaAction, syncPhotosAction } from "@/app/(app)/inbox/actions";

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

type PreviewKind =
  | "text"
  | "photo"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "poll"
  | "location"
  | "contact"
  | "reaction"
  | "other";

type GroupItem = {
  jid: string;
  name: string;
  description: string | null;
  participantCount: number;
  classification: Classification;
  pinned: boolean;
  conversationId: number | null;
  /** Date atravessa a fronteira do servidor como Date; da action, como texto. */
  lastMessageAt: string | Date | null;
  lastMessagePreview: string | null;
  lastMessageKind: PreviewKind | null;
  lastMessageSender: string | null;
  lastMessageFromMe: boolean;
  unreadCount: number;
  awaitingReply: boolean;
  photoUrl: string | null;
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
  mediaMimeType: string | null;
  mediaFileName: string | null;
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

/**
 * O ícone da prévia.
 *
 * No WhatsApp a legenda da foto ocupa a linha e o ícone conta que era foto.
 * Sem ele, "Chegou hoje" e "Foto" ficam com o mesmo peso e a lista perde a
 * pista mais rápida de leitura. Texto e reação não ganham ícone: o texto é o
 * caso comum, e "Reagiu com ❤️" já se explica.
 */
const ICONE_DA_PREVIA: Partial<Record<PreviewKind, typeof ImageIcon>> = {
  photo: ImageIcon,
  video: Video,
  audio: Mic,
  document: FileText,
  sticker: Smile,
  poll: BarChart3,
  location: MapPin,
  contact: Contact,
};

/** O retrato do WhatsApp é considerado velho depois disto e vale rebuscar. */
const RETRATO_VELHO_S = 300;

type Sincronia =
  | { ok: true; data: { grupos?: number; jaEmAndamento?: boolean; importadas?: number } }
  | { ok: false; error: string };

/**
 * Pede ao servidor a ida ao WhatsApp — por rota, não por server action.
 *
 * O navegador despacha server actions UMA DE CADA VEZ. Enquanto uma busca de
 * vinte segundos ocupava essa fila, trocar de gaveta ou digitar na busca ficava
 * parado atrás dela, e a lista sumia atrás do esqueleto pelo tempo inteiro
 * (23 s medidos na conta do dono). Numa rota comum o pedido sai na hora e a
 * tela continua respondendo enquanto a busca acontece.
 */
async function pedirSincronia(jid?: string): Promise<Sincronia> {
  try {
    const resposta = await fetch("/api/grupos/sincronizar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(jid ? { jid } : {}),
    });
    const corpo = (await resposta.json().catch(() => null)) as Sincronia | null;
    return corpo ?? { ok: false, error: "Não foi possível falar com o servidor." };
  } catch {
    // Rede caiu no meio: quem pediu explicitamente merece o aviso, e o disparo
    // automático simplesmente não faz nada — nunca uma promessa não tratada.
    return { ok: false, error: "Sem conexão com o servidor." };
  }
}

function tempoRelativo(iso: string | Date, fuso: string): string {
  const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutos < 1) return "agora";
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `${horas}h`;
  const dias = Math.round(horas / 24);
  if (dias < 7) return `${dias}d`;
  return formatTz(new Date(iso), fuso, "d MMM");
}

/** A primeira página, já montada pelo servidor. */
type PaginaInicial = {
  items: GroupItem[];
  total: number;
  counts: Record<Filtro, number>;
  snapshotAgeSeconds: number | null;
};

export function GruposView({
  connected,
  canManage,
  inicial,
}: {
  connected: boolean;
  canManage: boolean;
  inicial?: PaginaInicial | null;
}) {
  const [items, setItems] = useState<GroupItem[]>(inicial?.items ?? []);
  const [counts, setCounts] = useState<Record<Filtro, number>>(
    inicial?.counts ?? {
      all: 0,
      none: 0,
      radar: 0,
      opportunity: 0,
      private: 0,
    },
  );
  const [filtro, setFiltro] = useState<Filtro>("all");
  const [busca, setBusca] = useState("");
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(inicial?.total ?? 0);
  const [carregando, setCarregando] = useState(connected && !inicial);
  const [sincronizando, setSincronizando] = useState(false);
  // `undefined` = a lista ainda não voltou; `null` = voltou e nunca houve
  // retrato. Sem essa distinção o sync dispararia no mount de toda abertura,
  // antes de saber se havia motivo.
  const [retratoIdade, setRetratoIdade] = useState<number | null | undefined>(
    inicial ? inicial.snapshotAgeSeconds : undefined,
  );
  const [buscandoFotos, buscarFotos] = useTransition();
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [entrando, setEntrando] = useState(false);
  const pedido = useRef(0);

  const carregar = useCallback(
    async (proximoFiltro: Filtro, termo: string, proximoOffset: number, silencioso = false) => {
      const chamada = ++pedido.current;
      if (!silencioso) setCarregando(true);
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
      setRetratoIdade(resultado.data.snapshotAgeSeconds);
      setOffset(proximoOffset);
    },
    [],
  );

  /**
   * Buscar no WhatsApp é caro (vinte segundos na conta medida) e por isso ficou
   * FORA do caminho de abertura: a lista já pintou do banco quando isto começa,
   * e quando termina ela se repinta com o que chegou.
   */
  const sincronizar = useCallback(
    async (avisar: boolean) => {
      setSincronizando(true);
      try {
        const resultado = await pedirSincronia();
        if (!resultado.ok) {
          if (avisar) toast.error(resultado.error);
          return;
        }
        if (avisar) {
          toast.success(
            resultado.data.jaEmAndamento
              ? "Já tem uma atualização em andamento."
              : `${resultado.data.grupos ?? 0} grupos atualizados.`,
          );
        }
        await carregarRef.current();
      } finally {
        setSincronizando(false);
      }
    },
    [],
  );

  // O sync termina depois; quando terminar, recarrega o que a tela mostra
  // AGORA — que pode não ser mais a gaveta nem a busca de quando ele começou.
  const carregarRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    carregarRef.current = () => carregar(filtro, busca, offset, true);
  }, [carregar, filtro, busca, offset]);

  /**
   * O que a lista JÁ mostra, para não refazer a consulta que o servidor fez.
   *
   * Guardar "já usei a página do servidor" num sinalizador que se apaga na
   * primeira passada não funciona: o React remonta os efeitos, e a segunda
   * passada encontrava o sinalizador apagado e recarregava tudo — a lista que
   * tinha vindo pronta no HTML piscava para esqueleto por meio segundo
   * (medido) antes de voltar igual. Guardar a CONSULTA em vez do sinalizador
   * torna a decisão idempotente: mesma gaveta e mesma busca, nada a fazer.
   */
  const consultaNaTela = useRef<string | null>(inicial ? "all|" : null);

  useEffect(() => {
    if (!connected) return;
    const consulta = `${filtro}|${busca}`;
    if (consultaNaTela.current === consulta) return;
    const timer = setTimeout(() => {
      consultaNaTela.current = consulta;
      void carregar(filtro, busca, 0);
    }, busca ? 400 : 0);
    return () => clearTimeout(timer);
  }, [busca, filtro, connected, carregar]);

  /**
   * Uma sincronização por abertura de tela, e só quando o retrato está velho.
   * `null` é o caso de conta nova: nunca buscamos nada, então vale buscar.
   */
  const jaSincronizou = useRef(false);
  useEffect(() => {
    if (!connected || jaSincronizou.current || retratoIdade === undefined) return;
    if (retratoIdade !== null && retratoIdade < RETRATO_VELHO_S) return;
    // Fora do quadro atual de propósito: é trabalho de fundo, e começar dentro
    // do efeito faria a tela renderizar de novo antes mesmo de ter aparecido.
    // A marca fica DENTRO do disparo: marcá-la aqui fora fazia a remontagem
    // dos efeitos cancelar o único agendamento e nunca mais fazer outro — a
    // busca automática simplesmente não acontecia.
    const id = window.setTimeout(() => {
      jaSincronizou.current = true;
      void sincronizar(false);
    }, 0);
    return () => window.clearTimeout(id);
  }, [connected, retratoIdade, sincronizar]);

  useEffect(() => {
    if (!connected) return;
    let syncing = false;
    const sync = () => {
      if (document.hidden || syncing) return;
      syncing = true;
      void carregar(filtro, busca, offset, true).finally(() => {
        syncing = false;
      });
    };
    const events = new EventSource("/api/inbox/events");
    events.onmessage = sync;
    const timer = window.setInterval(sync, 30_000);
    const onVisible = () => {
      if (!document.hidden) sync();
    };
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      events.close();
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [busca, carregar, connected, filtro, offset]);

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
            {/* A foto do grupo é o que a atendente reconhece antes de ler o
                nome. Buscar daqui evita ter que ir ao Inbox para atualizar
                uma lista que se olha nesta tela. */}
            <Button
              variant="ghost"
              size="sm"
              title="Buscar no WhatsApp as fotos de perfil que ainda faltam"
              loading={buscandoFotos}
              onClick={() =>
                buscarFotos(async () => {
                  const r = await syncPhotosAction();
                  if (r.ok) {
                    toast.success(r.mensagem);
                    carregar(filtro, busca, 0);
                  } else {
                    toast.error(r.error);
                  }
                })
              }
            >
              <ImageDown aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              title="Buscar no WhatsApp as conversas novas dos grupos"
              loading={sincronizando || carregando}
              onClick={() => void sincronizar(true)}
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

        {total > PAGE_SIZE ? (
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
  const fuso = useFuso();
  const classe = CLASSIFICACOES.find((c) => c.id === group.classification);
  const IconePrevia = group.lastMessageKind ? ICONE_DA_PREVIA[group.lastMessageKind] : undefined;

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
        <Avatar name={group.name} src={group.photoUrl} size="lg" />
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
            // "há 3h" e "5d" dependem do instante da montagem, e o servidor
            // monta antes do navegador. O fuso deixou de ser o motivo.
            <span suppressHydrationWarning className="shrink-0 text-meta text-ink-secondary tabular">
              {tempoRelativo(group.lastMessageAt, fuso)}
            </span>
          ) : null}
        </span>

        <span className="mt-0.5 flex items-center gap-1.5">
          {group.participantCount > 0 ? (
            <span className="shrink-0 text-caption text-ink-tertiary tabular">{group.participantCount}</span>
          ) : null}
          {IconePrevia ? <IconePrevia className="size-3.5 shrink-0 text-ink-tertiary" aria-hidden /> : null}
          {/* A descrição do grupo já ocupou este lugar e enganava: texto fixo
              parado onde todo mundo procura a última fala. Sem última mensagem
              conhecida, o honesto é dizer que não há. */}
          <span className="min-w-0 flex-1 truncate text-caption text-ink-secondary">
            {group.lastMessagePreview ? (
              <>
                {group.lastMessageSender ? (
                  <span className="text-ink-tertiary">{group.lastMessageSender}: </span>
                ) : null}
                {group.lastMessagePreview}
              </>
            ) : (
              <span className="text-ink-tertiary">Sem mensagens recentes</span>
            )}
          </span>
          {group.unreadCount > 0 ? (
            /* `text-[10px]` estava fora da escala do produto (o menor degrau é
               `text-meta`, 11px) e sozinho no arquivo inteiro. Um número solto
               também não diz nada em leitor de tela — daí o rótulo. */
            <span
              aria-label={`${group.unreadCount} ${group.unreadCount === 1 ? "mensagem não lida" : "mensagens não lidas"}`}
              className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-meta font-semibold text-white tabular"
            >
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

type Aba = "conversa" | "membros" | "programadas" | "ajustes";

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
  const [conversationId, setConversationId] = useState<number | null>(group.conversationId);
  const [resumo, setResumo] = useState<string | null>(null);
  const [carregandoDetalhe, setCarregandoDetalhe] = useState(true);
  const [carregandoConversa, setCarregandoConversa] = useState(true);
  const [agendadas, setAgendadas] = useState(0);
  const [resumindo, startResumindo] = useTransition();
  const [classificando, startClassificando] = useTransition();

  const carregarThread = useCallback(async () => {
    const conversa = await groupThreadAction(group.jid);
    if (!conversa.ok) return;
    setConversationId(conversa.data.conversationId);
    setThread(conversa.data.messages as ThreadMessage[]);
  }, [group.jid]);

  /**
   * O fio primeiro, a ficha do grupo depois — e cada um pinta quando chega.
   *
   * Os dois pedidos estavam num `Promise.all` com um `.then` só, e o navegador
   * despacha server actions uma de cada vez: o fio, que sai do Postgres em
   * ~300 ms, só aparecia quando o `/group/info` (2,1 s a 2,8 s medidos na
   * uazapi) terminasse. Um grupo com 66 mensagens JÁ GRAVADAS ficava com o
   * painel vazio dizendo "buscando no WhatsApp" enquanto a lista, ao lado,
   * mostrava a última fala. Pedir o fio primeiro e tratar cada resposta na hora
   * é o que faz o painel abrir com o que já é nosso.
   *
   * O componente é remontado a cada grupo (key={jid}), então o estado já nasce
   * carregando: mudar isso dentro do efeito seria render em cascata à toa.
   */
  useEffect(() => {
    let ativo = true;
    void groupThreadAction(group.jid).then((conversa) => {
      if (!ativo) return;
      setCarregandoConversa(false);
      if (conversa.ok) {
        setConversationId(conversa.data.conversationId);
        setThread(conversa.data.messages as ThreadMessage[]);
      }
    });
    void getGroupAction(group.jid).then((info) => {
      if (!ativo) return;
      setCarregandoDetalhe(false);
      if (info.ok) setDetalhe(info.data as GroupDetail);
      else toast.error(info.error);
    });
    return () => {
      ativo = false;
    };
  }, [group.jid]);

  /**
   * Depois de pintar, busca no WhatsApp o que ainda não está aqui. Fora do
   * quadro atual pelo mesmo motivo da lista: é trabalho de fundo, e o painel
   * não pode esperar por ele para mostrar o que já tem.
   */
  useEffect(() => {
    let ativo = true;
    const id = window.setTimeout(() => {
      void pedirSincronia(group.jid).then((r) => {
        if (ativo && r.ok && (r.data.importadas ?? 0) > 0) void carregarThread();
      });
    }, 0);
    return () => {
      ativo = false;
      window.clearTimeout(id);
    };
  }, [group.jid, carregarThread]);

  // O webhook avisa pelo mesmo canal autenticado do Inbox. A reconciliação a
  // cada 30 s cobre oscilações sem exigir qualquer mudança na instância.
  useEffect(() => {
    let syncing = false;
    const sync = () => {
      if (document.hidden || syncing) return;
      syncing = true;
      void carregarThread().finally(() => {
        syncing = false;
      });
    };
    const events = new EventSource("/api/inbox/events");
    events.addEventListener("ready", sync);
    events.onmessage = sync;
    const timer = window.setInterval(sync, 30_000);
    const onVisible = () => {
      if (!document.hidden) sync();
    };
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      events.close();
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [carregarThread]);

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
          <Avatar name={group.name} src={group.photoUrl} size="md" />
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
              ["programadas", agendadas > 0 ? `Programadas (${agendadas})` : "Programadas"],
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
          <GroupThread
            jid={group.jid}
            conversationId={conversationId}
            messages={thread}
            carregando={carregandoConversa}
            ultimaConhecida={group}
            onSent={() => void carregarThread()}
          />
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

        {aba === "programadas" ? (
          <ScheduledPanel
            group={group}
            participantCount={detalhe?.participantCount ?? group.participantCount}
            onCountChange={setAgendadas}
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
  conversationId,
  messages,
  carregando,
  ultimaConhecida,
  onSent,
}: {
  jid: string;
  conversationId: number | null;
  messages: ThreadMessage[];
  carregando: boolean;
  /** O que a lista já sabe do grupo, para o vazio não contradizer a linha. */
  ultimaConhecida: Pick<GroupItem, "lastMessagePreview" | "lastMessageSender" | "lastMessageAt">;
  onSent: () => void;
}) {
  const fuso = useFuso();
  const [texto, setTexto] = useState("");
  const [arquivo, setArquivo] = useState<{ file: File; kind: "image" | "video" | "ptt" | "document" } | null>(null);
  const [enviando, startEnviando] = useTransition();
  const fim = useRef<HTMLDivElement>(null);
  const inputArquivo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  function enviar() {
    const corpo = texto.trim();
    if (!corpo && !arquivo) return;
    setTexto("");
    startEnviando(async () => {
      let media: { kind: "image" | "video" | "ptt" | "document"; dataUrl: string; fileName: string } | null = null;
      try {
        if (arquivo) media = { kind: arquivo.kind, dataUrl: await lerArquivo(arquivo.file), fileName: arquivo.file.name };
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Não foi possível ler o arquivo.");
        setTexto(corpo);
        return;
      }
      const resultado = await sendToGroupAction({ jid, body: corpo, media });
      if (!resultado.ok) {
        toast.error(resultado.error);
        setTexto(corpo);
        return;
      }
      setArquivo(null);
      onSent();
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-3 py-4 md:px-6">
        {messages.length === 0 && carregando ? (
          <p className="mx-auto max-w-[560px] rounded-card bg-surface-sunken px-4 py-6 text-center text-caption text-ink-secondary">
            Buscando no WhatsApp o que já foi dito aqui…
          </p>
        ) : messages.length === 0 && ultimaConhecida.lastMessagePreview ? (
          /* A lista mostra a última fala e este painel dizia que nada tinha
             chegado: duas telas contando histórias diferentes sobre o mesmo
             grupo. O painel agora repete o que a lista sabe e explica a
             diferença — a fala está no aparelho, ainda não no nosso acervo. */
          <p className="mx-auto max-w-[560px] rounded-card bg-surface-sunken px-4 py-6 text-center text-caption text-ink-secondary">
            No WhatsApp, a última mensagem daqui é
            {ultimaConhecida.lastMessageSender ? ` de ${ultimaConhecida.lastMessageSender}` : ""}
            {ultimaConhecida.lastMessageAt ? `, há ${tempoRelativo(ultimaConhecida.lastMessageAt, fuso)}` : ""}:{" "}
            <span className="text-ink">“{ultimaConhecida.lastMessagePreview}”</span>. O histórico ainda está sendo
            trazido do aparelho e aparece aqui assim que chegar.
          </p>
        ) : messages.length === 0 ? (
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
                    {mensagem.messageType !== "text" && conversationId ? (
                      <GroupMessageMedia
                        key={mensagem.mediaUrl ?? "sem-url"}
                        conversationId={conversationId}
                        message={mensagem}
                        onLoaded={onSent}
                      />
                    ) : null}
                    {mensagem.audioTranscription || (mensagem.body && !/^\[[^\]]+\]$/.test(mensagem.body)) ? (
                      <span className="block whitespace-pre-wrap">
                        {mensagem.audioTranscription || mensagem.body}
                      </span>
                    ) : null}
                  </div>
                  <span className="mt-0.5 px-1 text-meta text-ink-secondary">
                    {formatTz(new Date(mensagem.createdAt), fuso, "dd/MM HH:mm")}
                  </span>
                </div>
              );
            })}
            <div ref={fim} />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line bg-surface-raised px-3 py-2.5 md:px-6">
        <div className="mx-auto flex max-w-[680px] flex-col gap-2">
          {arquivo ? (
            <span className="flex w-fit max-w-full items-center gap-1.5 rounded-control bg-surface-sunken px-2 py-1 text-caption text-ink">
              <Paperclip className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{arquivo.file.name}</span>
              <button type="button" onClick={() => setArquivo(null)} aria-label="Remover arquivo">
                <X className="size-3.5" aria-hidden />
              </button>
            </span>
          ) : null}
          <div className="flex items-end gap-2">
          <input
            ref={inputArquivo}
            type="file"
            hidden
            accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.zip"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              if (file.size > 10 * 1024 * 1024) {
                toast.error("Arquivo muito grande. O limite é 10 MB.");
                return;
              }
              setArquivo({ file, kind: tipoDoArquivo(file) });
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="md"
            className="h-11 shrink-0"
            title="Anexar arquivo"
            onClick={() => inputArquivo.current?.click()}
          >
            <Paperclip aria-hidden />
          </Button>
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
          <Button variant="primary" size="md" className="h-11 shrink-0" loading={enviando} disabled={!texto.trim() && !arquivo} onClick={enviar}>
            <Send aria-hidden />
          </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Prévia e recuperação de mídia do grupo, inclusive quando o link expirou. */
function GroupMessageMedia({
  conversationId,
  message,
  onLoaded,
}: {
  conversationId: number;
  message: ThreadMessage;
  onLoaded: () => void;
}) {
  const [url, setUrl] = useState(message.mediaUrl);
  const [loading, startLoading] = useTransition();
  const attempted = useRef(false);
  const downloadable = ["image", "video", "audio", "ptt", "document", "sticker"].includes(message.messageType);

  const refresh = useCallback((openAfter: boolean) => {
    const tab = openAfter ? window.open("about:blank", "_blank") : null;
    startLoading(async () => {
      const result = await loadMediaAction({ conversationId, messageId: message.id });
      if (!result.ok || !result.url) {
        tab?.close();
        toast.error(result.ok ? "Este arquivo não está mais disponível no WhatsApp." : result.error);
        return;
      }
      setUrl(result.url);
      if (tab) tab.location.href = result.url;
      onLoaded();
    });
  }, [conversationId, message.id, onLoaded]);

  useEffect(() => {
    if (url || !downloadable || attempted.current) return;
    attempted.current = true;
    refresh(false);
  }, [downloadable, refresh, url]);

  if (message.messageType === "image" || message.messageType === "sticker") {
    return url ? (
      <a href={url} target="_blank" rel="noreferrer" className="mb-1 block">
        <img
          src={url}
          alt={message.mediaFileName || "Imagem do grupo"}
          className="max-h-[280px] w-auto rounded-control"
          onError={() => refresh(false)}
        />
      </a>
    ) : <MediaLoadLabel loading={loading} label="Foto" onRetry={() => refresh(false)} />;
  }
  if (message.messageType === "video") {
    return url ? (
      <video controls src={url} className="mb-1 max-h-[280px] w-auto rounded-control" onError={() => refresh(false)} />
    ) : <MediaLoadLabel loading={loading} label="Vídeo" onRetry={() => refresh(false)} />;
  }
  if (message.messageType === "audio" || message.messageType === "ptt") {
    return url ? (
      <audio controls src={url} className="mb-1 h-9 w-[240px] max-w-full" onError={() => refresh(false)} />
    ) : <MediaLoadLabel loading={loading} label="Áudio" onRetry={() => refresh(false)} />;
  }
  if (message.messageType === "document") {
    return (
      <button type="button" disabled={loading} onClick={() => refresh(true)} className="mb-1 flex max-w-full items-center gap-1.5 text-caption text-accent">
        <Paperclip className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{message.mediaFileName || "Abrir arquivo"}</span>
        <span>{loading ? "carregando…" : "abrir"}</span>
      </button>
    );
  }
  return <span className="mb-1 block text-caption text-ink-secondary">[{message.messageType}]</span>;
}

function MediaLoadLabel({ loading, label, onRetry }: { loading: boolean; label: string; onRetry: () => void }) {
  return (
    <span className="mb-1 flex items-center gap-1.5 text-caption text-ink-secondary">
      <Paperclip className="size-3.5" aria-hidden />
      {label}
      {loading ? <span>carregando…</span> : <button type="button" onClick={onRetry} className="text-accent">tentar novamente</button>}
    </span>
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
          <Button variant="primary"
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
        className="mt-1 size-5 shrink-0 accent-accent"
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
        <Button variant="primary"
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
        <Button variant="primary"
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

const MEDIA_ROTULO: Record<string, string> = {
  image: "Foto",
  video: "Vídeo",
  audio: "Áudio",
  document: "Arquivo",
};

/** O tipo do anexo sai do próprio arquivo; ninguém deveria ter que escolher. */
function tipoDoArquivo(file: File): "image" | "video" | "ptt" | "document" {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "ptt";
  return "document";
}

function lerArquivo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result));
    leitor.onerror = () => reject(new Error("Não consegui ler o arquivo."));
    leitor.readAsDataURL(file);
  });
}

/** Data e hora local no formato que o campo do navegador entende. */
function paraCampoLocal(data: Date): string {
  const deslocado = new Date(data.getTime() - data.getTimezoneOffset() * 60_000);
  return deslocado.toISOString().slice(0, 16);
}

/**
 * Mensagens programadas do grupo.
 *
 * O caso real é o aviso que precisa sair numa hora específica — promoção que
 * abre, lembrete de véspera, recado de fim de expediente — e que ninguém quer
 * depender de lembrar de mandar. Marcar todos existe porque em grupo grande a
 * mensagem sem menção passa despercebida.
 */
function ScheduledPanel({
  group,
  participantCount,
  onCountChange,
}: {
  group: GroupItem;
  participantCount: number;
  onCountChange: (quantidade: number) => void;
}) {
  const fuso = useFuso();
  const [itens, setItens] = useState<ScheduledView[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [texto, setTexto] = useState("");
  const [marcarTodos, setMarcarTodos] = useState(false);
  const [arquivo, setArquivo] = useState<{ file: File; kind: string } | null>(null);
  const [quando, setQuando] = useState(() => paraCampoLocal(new Date(Date.now() + 3_600_000)));
  const [salvando, startSalvando] = useTransition();
  const inputArquivo = useRef<HTMLInputElement>(null);

  const recarregar = useCallback(async () => {
    const resultado = await listScheduledAction(group.jid);
    setCarregando(false);
    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }
    setItens(resultado.data);
    onCountChange(resultado.data.filter((i) => i.status === "pending").length);
  }, [group.jid, onCountChange]);

  useEffect(() => {
    const timer = setTimeout(() => void recarregar(), 0);
    return () => clearTimeout(timer);
  }, [recarregar]);

  function agendar() {
    startSalvando(async () => {
      const media = arquivo
        ? {
            kind: arquivo.kind as "image" | "video" | "document" | "ptt",
            dataUrl: await lerArquivo(arquivo.file),
            fileName: arquivo.file.name,
          }
        : null;

      const resultado = await scheduleGroupMessageAction({
        jid: group.jid,
        groupName: group.name,
        body: texto.trim(),
        mentionAll: marcarTodos,
        scheduledFor: quando,
        media,
      });
      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }
      toast.success("Mensagem programada");
      setTexto("");
      setArquivo(null);
      setMarcarTodos(false);
      void recarregar();
    });
  }

  const pendentes = itens.filter((i) => i.status === "pending");
  const passadas = itens.filter((i) => i.status !== "pending");

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5 px-4 py-4">
      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface-raised p-4">
        <p className="text-card text-ink">Programar mensagem</p>

        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={4}
          maxLength={4000}
          placeholder="O que deve ser enviado neste grupo"
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => inputArquivo.current?.click()}>
            <Paperclip aria-hidden />
            {arquivo ? "Trocar arquivo" : "Foto, vídeo, áudio ou arquivo"}
          </Button>
          <input
            ref={inputArquivo}
            type="file"
            hidden
            accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              if (file.size > 5 * 1024 * 1024) {
                toast.error("Arquivo muito grande para agendar. O limite é 5 MB.");
                return;
              }
              setArquivo({ file, kind: tipoDoArquivo(file) });
            }}
          />
          {arquivo ? (
            <span className="flex items-center gap-1.5 rounded-control bg-surface-sunken px-2 py-1 text-caption text-ink">
              {MEDIA_ROTULO[arquivo.kind === "ptt" ? "audio" : arquivo.kind]} · {arquivo.file.name}
              <button type="button" onClick={() => setArquivo(null)} aria-label="Remover arquivo">
                <X className="size-3.5" aria-hidden />
              </button>
            </span>
          ) : null}
        </div>

        <label className="flex cursor-pointer items-start justify-between gap-3 border-t border-line pt-3">
          <span className="min-w-0">
            <span className="block text-label text-ink">Marcar todos</span>
            <span className="block text-caption text-ink-secondary">
              Notifica {participantCount > 0 ? `as ${participantCount} pessoas` : "todo mundo"} do grupo. A lista é lida
              na hora do envio, então quem entrar até lá também é marcado.
            </span>
          </span>
          <input
            type="checkbox"
            checked={marcarTodos}
            onChange={(e) => setMarcarTodos(e.target.checked)}
            className="mt-1 size-5 shrink-0 accent-accent"
          />
        </label>

        <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
          <div className="min-w-[220px] flex-1">
            <Field label="Enviar em" hint="Horário do seu computador.">
              <Input type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} />
            </Field>
          </div>
          <Button variant="primary"
            size="md"
            className="h-11"
            loading={salvando}
            disabled={!texto.trim() && !arquivo}
            onClick={agendar}
          >
            <CalendarClock aria-hidden />
            Programar
          </Button>
        </div>
      </div>

      <div>
        <p className="mb-2 text-meta font-medium tracking-wide text-ink-secondary uppercase">
          Na fila ({pendentes.length})
        </p>
        {carregando ? (
          <div className="h-16 animate-pulse rounded-card bg-surface-sunken" />
        ) : pendentes.length === 0 ? (
          <p className="rounded-control bg-surface-sunken px-3 py-4 text-center text-caption text-ink-secondary">
            Nada programado para este grupo.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pendentes.map((item) => (
              <li key={item.id} className="rounded-card border border-line bg-surface-raised p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-label text-ink tabular">
                      {formatTz(new Date(item.scheduledFor), fuso, "dd/MM 'às' HH:mm")}
                    </p>
                    {item.body ? (
                      <p className="mt-0.5 line-clamp-3 text-caption text-ink-secondary">{item.body}</p>
                    ) : null}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {item.hasMedia ? (
                        <Badge tone="neutral">
                          <Paperclip className="size-3" aria-hidden />
                          {MEDIA_ROTULO[item.mediaKind ?? "document"] ?? "Arquivo"}
                        </Badge>
                      ) : null}
                      {item.mentionAll ? <Badge tone="info">Marca todos</Badge> : null}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      if (!confirm("Cancelar este envio?")) return;
                      const resultado = await cancelScheduledAction(item.id);
                      if (!resultado.ok) {
                        toast.error(resultado.error);
                        return;
                      }
                      toast.success("Envio cancelado");
                      void recarregar();
                    }}
                  >
                    Cancelar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {passadas.length > 0 ? (
        <div>
          <p className="mb-2 text-meta font-medium tracking-wide text-ink-secondary uppercase">Histórico</p>
          <ul className="flex flex-col gap-1.5">
            {passadas.map((item) => (
              <li
                key={item.id}
                className="flex items-start justify-between gap-2 rounded-control border border-line px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-caption text-ink">{item.body || "(só arquivo)"}</p>
                  <p className="text-meta text-ink-secondary tabular">
                    {formatTz(new Date(item.scheduledFor), fuso, "dd/MM HH:mm")}
                  </p>
                  {item.error ? <p className="mt-0.5 text-meta text-danger">{item.error}</p> : null}
                </div>
                <Badge
                  tone={item.status === "sent" ? "positive" : item.status === "failed" ? "danger" : "neutral"}
                >
                  {item.status === "sent" ? "Enviada" : item.status === "failed" ? "Falhou" : "Cancelada"}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
