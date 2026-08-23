"use client";

import { differenceInCalendarDays, format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Bot,
  CalendarCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Clock,
  Headphones,
  Inbox as InboxIcon,
  LayoutGrid,
  ListOrdered,
  Mail,
  MessageSquare,
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
import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { listGroupsAction } from "../grupos/actions";
import { Composer, type ReplyTarget } from "./composer";
import { NewConversationButton } from "./new-conversation-dialog";
import {
  DeliveryTick,
  MEDIA_ICON,
  MEDIA_LABEL,
  MessageBubble,
  SeparadorDeData,
  mesmoDia,
  mesmoGrupo,
  textoVisivel,
} from "./message-bubble";
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
  lastMessageType: string | null;
  lastMessageStatus: string | null;
  lastMessageTranscription: string | null;
  assignedUserId: number | null;
  assignedUserName: string | null;
  lastAssignedUserName: string | null;
  photoUrl: string | null;
};

type Tab = "meus" | "fila" | "todos" | "resolvidas";

/**
 * Mensagem que já está na tela mas ainda não foi confirmada pelo servidor.
 *
 * `criadoEm` existe para casar o rascunho com a mensagem de verdade quando ela
 * chega pela leitura periódica: sem a janela de tempo, duas mensagens iguais
 * enviadas em momentos diferentes se confundiriam e uma sumiria da tela.
 */
type Draft = {
  tempId: string;
  conversationId: number;
  body: string;
  replyToExternalId?: string;
  failed: boolean;
  criadoEm: number;
};

/** Quanto tempo depois do rascunho a mensagem confirmada ainda conta como ele. */
const JANELA_DO_ECO_MS = 120_000;

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

/** Rede ou proxy podem interromper SSE; esta varredura é apenas a rede de segurança. */
const FALLBACK_POLL_MS = 30_000;

/**
 * Quando a conversa falou pela última vez.
 *
 * "há 13 h" obriga a fazer conta para saber se foi antes ou depois do almoço —
 * e a atendente precisa exatamente disso para decidir o que responder primeiro.
 * Hora absoluta hoje, dia da semana na semana corrente, data depois: é a régua
 * de todo aplicativo de mensagem porque é a que dispensa a conta.
 */
function horaDaLista(iso: string): string {
  const data = new Date(iso);
  if (isToday(data)) return format(data, "HH:mm", { locale: ptBR });
  if (isYesterday(data)) return "Ontem";
  if (differenceInCalendarDays(new Date(), data) < 7) return format(data, "EEEEEE", { locale: ptBR });
  return format(data, "dd/MM", { locale: ptBR });
}

/**
 * A frase da prévia na lista.
 *
 * Antes, mensagem sem corpo — foto, áudio, documento — deixava a linha vazia ou
 * mostrava o marcador interno `[áudio]`. Quem varre a fila fica sem saber se a
 * cliente mandou uma foto do resultado ou uma dúvida.
 */
function previaDaConversa(conversation: ConversationItem): { texto: string; rotulo: string | null } {
  const tipo = conversation.lastMessageType ?? "text";
  const rotulo = MEDIA_LABEL[tipo] ?? null;
  const corpo = textoVisivel(conversation.lastMessagePreview);

  if (tipo === "audio" || tipo === "ptt") {
    // A transcrição é mais útil que o rótulo: diz o que foi pedido sem ouvir.
    return { texto: conversation.lastMessageTranscription?.trim() || "Mensagem de voz", rotulo: "Mensagem de voz" };
  }
  if (corpo) return { texto: corpo, rotulo };
  if (rotulo) return { texto: rotulo, rotulo };
  return { texto: conversation.lastMessageAt ? "Mensagem" : "Sem mensagens", rotulo: null };
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
  canStartConversation,
}: {
  conversations: ConversationItem[];
  counts: { meus: number; fila: number; todos: number };
  initialDetail: InboxDetail | null;
  initialSelectedId: number | null;
  initialTab: Tab;
  currentUserId: number;
  whatsappConnected: boolean;
  canSupervise: boolean;
  /** Iniciar conversa é ação de staff; profissional não vê o botão. */
  canStartConversation: boolean;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  /** O que está digitado na busca. */
  const [termo, setTermo] = useState("");
  /** O que já virou consulta — atrasado em 300 ms para não pedir por tecla. */
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
  /**
   * Só no desktop a lista e a conversa convivem. No celular a lista É a tela, e
   * escolher uma conversa sozinho tiraria a atendente de onde ela está.
   */
  const doisPaineis = useSyncExternalStore(
    (aoMudar) => {
      const consulta = window.matchMedia("(min-width: 768px)");
      consulta.addEventListener("change", aoMudar);
      return () => consulta.removeEventListener("change", aoMudar);
    },
    () => window.matchMedia("(min-width: 768px)").matches,
    () => true,
  );
  const [, startSending] = useTransition();
  const [, startSwitching] = useTransition();
  const [acting, startActing] = useTransition();
  const threadRef = useRef<HTMLDivElement>(null);
  const listReqRef = useRef(0);
  const requestRef = useRef<number | null>(null);
  /** Botão de descer + contador do que chegou enquanto se lia o histórico. */
  const [longeDoFim, setLongeDoFim] = useState(false);
  const [naoVistas, setNaoVistas] = useState(0);
  const pertoDoFimRef = useRef(true);
  const conversaRolada = useRef<number | null>(null);
  const totalRenderizado = useRef(0);

  const activeId = selectedId ?? initialDetail?.conversationId ?? null;
  const detail = activeId == null ? null : (cache[activeId] ?? null);
  /**
   * O rascunho some assim que a mensagem de verdade aparece no fio.
   *
   * Sem este casamento a bolha aparecia DUAS vezes: a leitura periódica traz a
   * mensagem confirmada em até dez segundos, e o rascunho só saía quando o
   * `sendMessageAction` respondia. Corpo igual e criada depois que o envio
   * começou é o que identifica o par — o par (corpo, janela) evita que uma
   * mensagem idêntica de antes engula um rascunho que ainda precisa de "tentar
   * de novo".
   */
  const conversationDrafts = drafts.filter((d) => {
    if (d.conversationId !== activeId) return false;
    return !(detail?.messages ?? []).some((m) => {
      if (m.direction !== "outbound" || m.body !== d.body) return false;
      const quando = new Date(m.createdAt).getTime();
      return quando > d.criadoEm - 5_000 && quando < d.criadoEm + JANELA_DO_ECO_MS;
    });
  });
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

  /**
   * Rolagem automática só quando ela é bem-vinda.
   *
   * Antes o efeito rolava à força a cada leitura periódica: quem estava lendo o
   * histórico de dez dias atrás era arrancado para o rodapé de dez em dez
   * segundos, sem ter feito nada. Agora só desce se a conversa MUDOU (aí o
   * rodapé é o começo natural) ou se já se estava colado no fim — e o que chegou
   * enquanto se lia vira contador no botão de descer, em vez de um empurrão.
   */
  useEffect(() => {
    const alvo = threadRef.current;
    if (!alvo || detail == null) return;
    const total = detail.messages.length + conversationDrafts.length;

    if (conversaRolada.current !== detail.conversationId) {
      conversaRolada.current = detail.conversationId;
      totalRenderizado.current = total;
      pertoDoFimRef.current = true;
      setNaoVistas(0);
      setLongeDoFim(false);
      alvo.scrollTo({ top: alvo.scrollHeight });
      return;
    }

    const chegaram = total - totalRenderizado.current;
    totalRenderizado.current = total;
    if (pertoDoFimRef.current) {
      alvo.scrollTo({ top: alvo.scrollHeight });
      return;
    }
    if (chegaram > 0) setNaoVistas((atual) => atual + chegaram);
  }, [detail, conversationDrafts.length]);

  /**
   * Guarda a conversa recém-lida e aposenta os rascunhos que ela já contém.
   *
   * A limpeza mora aqui, e não num efeito sobre `detail`, porque é consequência
   * direta de uma leitura: sem ela o rascunho ficaria invisível mas eterno no
   * estado, e um "tentar de novo" tardio reenviaria algo que já saiu.
   */
  const guardarConversa = useCallback((conversationId: number, loaded: InboxDetail) => {
    setCache((prev) => ({ ...prev, [conversationId]: loaded }));
    setDrafts((atuais) => {
      const restantes = atuais.filter((d) => {
        if (d.conversationId !== conversationId) return true;
        return !loaded.messages.some((m) => {
          if (m.direction !== "outbound" || m.body !== d.body) return false;
          const quando = new Date(m.createdAt).getTime();
          return quando > d.criadoEm - 5_000 && quando < d.criadoEm + JANELA_DO_ECO_MS;
        });
      });
      return restantes.length === atuais.length ? atuais : restantes;
    });
  }, []);

  function aoRolar() {
    const alvo = threadRef.current;
    if (!alvo) return;
    const distancia = alvo.scrollHeight - alvo.scrollTop - alvo.clientHeight;
    // Duas fronteiras de propósito: 80px é "ainda estou no fim, pode descer
    // sozinho"; 200px é "já subi de verdade, me ofereça o botão". Uma fronteira
    // só faria o botão piscar exatamente onde a rolagem automática age.
    pertoDoFimRef.current = distancia < 80;
    setLongeDoFim(distancia > 200);
    if (distancia < 80) setNaoVistas((atual) => (atual === 0 ? atual : 0));
  }

  function descerAoFim() {
    const alvo = threadRef.current;
    if (!alvo) return;
    pertoDoFimRef.current = true;
    setNaoVistas(0);
    setLongeDoFim(false);
    alvo.scrollTo({ top: alvo.scrollHeight, behavior: "smooth" });
  }

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
    async (nextTab: Tab, term: string): Promise<ConversationItem[] | null> => {
      const meu = (listReqRef.current += 1);
      const resultado = await listConversationsAction({ tab: nextTab, search: term || undefined });
      if (listReqRef.current !== meu) return null;
      if (!resultado.ok) {
        toast.error(resultado.error);
        return null;
      }
      const linhas = resultado.rows as ConversationItem[];
      setList(linhas);
      // Os contadores viajam junto: antes eles vinham só no carregamento da
      // página e "Fila 3" continuava 3 enquanto chegavam mais dez.
      setTabCounts(resultado.counts);
      return linhas;
    },
    [],
  );

  // O webhook publica no Redis e este canal autenticado avisa a tela assim que
  // o banco terminou de gravar. EventSource se reconecta sozinho se a internet
  // oscilar; o intervalo abaixo é apenas a rede de segurança.
  useEffect(() => {
    let syncing = false;
    let queued = false;

    const sync = async () => {
      if (document.hidden) return;
      if (syncing) {
        queued = true;
        return;
      }
      syncing = true;
      do {
        queued = false;
        await refreshList(tab, search);
        if (activeId) {
          const loaded = await loadConversationAction(activeId, { markRead: false });
          if (loaded) guardarConversa(activeId, loaded);
        }
      } while (queued);
      syncing = false;
    };

    const events = new EventSource("/api/inbox/events");
    events.addEventListener("ready", () => void sync());
    events.onmessage = () => void sync();

    const onVisible = () => {
      if (!document.hidden) void sync();
    };
    const timer = setInterval(() => void sync(), FALLBACK_POLL_MS);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      events.close();
      clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tab, search, activeId, refreshList, guardarConversa]);

  /**
   * Busca com respiro de 300 ms.
   *
   * "mariana" disparava sete consultas ao servidor, uma por tecla, e as seis
   * primeiras eram jogadas fora pela guarda de sequência — trabalho puro de
   * banco por letra digitada.
   */
  const montou = useRef(false);
  useEffect(() => {
    if (!montou.current) {
      // A primeira lista já veio renderizada pelo servidor; repetir a consulta
      // no mount seria uma ida à toa em toda abertura do inbox.
      montou.current = true;
      return;
    }
    const timer = setTimeout(() => setSearch(termo), 300);
    return () => clearTimeout(timer);
  }, [termo]);

  // A comparação com o termo já aplicado é o que impede a troca de aba de
  // consultar duas vezes: `changeTab` já recarrega, e este efeito só reage a
  // uma busca de fato nova.
  const buscaAplicada = useRef(search);
  useEffect(() => {
    if (buscaAplicada.current === search) return;
    buscaAplicada.current = search;
    void refreshList(tab, search);
  }, [search, tab, refreshList]);

  function changeTab(next: Tab) {
    setTab(next);
    startSwitching(async () => {
      const linhas = await refreshList(next, search);
      if (!linhas || !doisPaineis) return;
      // No desktop os dois painéis convivem: sem isto, trocar de aba deixava
      // metade da tela em "Escolha uma conversa" mesmo com a lista cheia.
      if (linhas.length === 0) {
        setSelectedId(null);
        syncUrl(null);
        return;
      }
      // `marcarLida: false` porque ninguém escolheu esta conversa — a aba
      // escolheu por ela. Marcar lida aqui apagava o não lido da primeira da
      // Fila só porque alguém clicou na aba, e o número da Fila é justamente
      // como a clínica sabe o que ainda está esperando resposta.
      if (!linhas.some((c) => c.id === activeId)) open(linhas[0].id, { marcarLida: false });
    });
  }

  function syncUrl(id: number | null) {
    window.history.replaceState(null, "", id ? `/inbox?conversa=${id}` : "/inbox");
  }

  function open(id: number, { marcarLida = true }: { marcarLida?: boolean } = {}) {
    setSelectedId(id);
    syncUrl(id);
    // Pelo mesmo motivo da `key` do Composer: o alvo de resposta é estado desta
    // tela e sobreviveria à troca, fazendo a mensagem sair citando a fala de
    // outra cliente.
    setReply(null);
    // Abrir zera o não lido; refletir na hora evita o contador fantasma.
    if (marcarLida) setList((prev) => prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
    requestRef.current = id;
    startSwitching(async () => {
      const loaded = await loadConversationAction(id, { markRead: marcarLida });
      if (requestRef.current !== id) return;
      if (loaded) guardarConversa(id, loaded);
      else toast.error("Não foi possível abrir a conversa.");
    });
  }

  async function reload(conversationId: number) {
    const loaded = await loadConversationAction(conversationId);
    if (loaded) guardarConversa(conversationId, loaded);
    await refreshList(tab, search);
  }

  function deliver(rascunho: Draft) {
    const { conversationId, body, tempId, replyToExternalId } = rascunho;
    startSending(async () => {
      try {
        const result = await sendMessageAction({ conversationId, body, replyToExternalId });
        if (!result.ok) {
          setDrafts((prev) => prev.map((d) => (d.tempId === tempId ? { ...d, failed: true } : d)));
          toast.error(result.error);
          return;
        }
        await reload(conversationId);
        // Sem toast de sucesso: a bolha na conversa já é a confirmação.
        setDrafts((prev) => prev.filter((d) => d.tempId !== tempId));
      } catch (erro) {
        // Rejeição (rede caiu, 500) não pode evaporar a frase: ela continua na
        // bolha, com "tentar de novo" e "descartar".
        console.error(erro);
        setDrafts((prev) => prev.map((d) => (d.tempId === tempId ? { ...d, failed: true } : d)));
        toast.error("Não foi possível enviar. O texto continua aqui na conversa.");
      }
    });
  }

  /**
   * Eco otimista: a bolha aparece ANTES da ida ao servidor.
   *
   * Medido: sem isto a mensagem sumia da tela por 4 a 7 segundos entre apertar
   * Enter e a leitura periódica trazê-la de volta — tempo em que a atendente
   * não sabe se enviou, e reenvia.
   */
  function registrarEnvio({ body, replyToExternalId }: { body: string; replyToExternalId?: string }): boolean {
    if (activeId == null) return false;
    const rascunho: Draft = {
      tempId: crypto.randomUUID(),
      conversationId: activeId,
      body,
      replyToExternalId,
      failed: false,
      criadoEm: Date.now(),
    };
    setDrafts((prev) => [...prev, rascunho]);
    // A bolha nova é o fim da conversa: quem envia sempre quer ver o que enviou.
    pertoDoFimRef.current = true;
    deliver(rascunho);
    return true;
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

          {/* Iniciar conversa fica acima da busca e não ao lado dela: é a ação
              da caixa inteira, não um filtro da lista. Escondido para quem não
              pode iniciar, e desativado enquanto não há WhatsApp conectado —
              um botão que abre um diálogo para dar erro no fim é pior que
              nenhum botão. */}
          {canStartConversation ? (
            <NewConversationButton
              className="w-full justify-center"
              disabled={!whatsappConnected}
              onStarted={(conversationId: number) => {
                setTab("meus");
                open(conversationId);
                void refreshList("meus", "");
              }}
            />
          ) : null}

          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-tertiary"
                aria-hidden
              />
              <Input
                value={termo}
                onChange={(event) => setTermo(event.target.value)}
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
                      // `shadow-sticky` e não `shadow-[var(--shadow-raised)]`:
                      // esse token nunca existiu. Uma propriedade que aponta
                      // para uma custom property indefinida é inválida em tempo
                      // de computação — medido como `none`. A aba ativa ficava
                      // sem relevo nenhum, sem erro de build, tipo ou lint.
                      ? "bg-surface-raised text-accent shadow-sticky"
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

            <div className="relative flex min-h-0 flex-1 flex-col">
              <div
                data-fio
                ref={threadRef}
                onScroll={aoRolar}
                className="flex flex-1 flex-col overflow-y-auto px-3 py-4 md:px-6"
              >
                {/* O contexto do cliente vive no trilho lateral; abaixo de lg ele
                    abre a conversa, para não sumir justamente no aparelho onde
                    trocar de tela custa mais. */}
                <div className="mx-auto mb-3 w-full max-w-[680px] shrink-0 lg:hidden">
                  <ContactPanel context={detail.context} photoUrl={detail.photoUrl} compact />
                </div>
                {/* A conversa cresce de baixo para cima: a última mensagem encosta
                    no composer, como em qualquer thread. O espaço entre bolhas é
                    de cada uma, não do contêiner: bolhas do mesmo bloco se
                    aproximam e só o intervalo entre blocos continua largo. */}
                <div className="mx-auto mt-auto flex w-full max-w-[680px] flex-col">
                  {detail.messages.map((message, indice) => {
                    const anterior = detail.messages[indice - 1];
                    const seguinte = detail.messages[indice + 1];
                    const trocouODia = !anterior || !mesmoDia(anterior.createdAt, message.createdAt);
                    return (
                      <Fragment key={message.id}>
                        {trocouODia ? <SeparadorDeData iso={message.createdAt} /> : null}
                        <MessageBubble
                          message={message}
                          conversationId={detail.conversationId}
                          agrupada={!trocouODia && mesmoGrupo(anterior, message)}
                          ultimaDoGrupo={!seguinte || !mesmoGrupo(message, seguinte)}
                          quoted={
                            message.quotedExternalId
                              ? (detail.messages.find((m) => m.externalId === message.quotedExternalId) ?? null)
                              : null
                          }
                          onReply={() =>
                            setReply({
                              messageId: message.id,
                              externalId: message.externalId,
                              preview: (
                                message.audioTranscription ||
                                textoVisivel(message.body) ||
                                MEDIA_LABEL[message.messageType] ||
                                "Mídia"
                              ).slice(0, 80),
                              fromMe: message.direction === "outbound",
                            })
                          }
                          onChanged={() => void reload(detail.conversationId)}
                        />
                      </Fragment>
                    );
                  })}
                  {conversationDrafts.map((item) => (
                    <div key={item.tempId} className="mt-2.5 flex flex-col items-end">
                      <div
                        className={cn(
                          "max-w-[85%] rounded-card px-3 py-2 text-body shadow-card",
                          // A palidez é do FUNDO, não do texto. Com `opacity-70`
                          // na bolha inteira o "Enviando…" de 11px caía para
                          // 2,75:1 contra ela — medido — bem abaixo dos 4,5:1,
                          // logo no único elemento cujo trabalho é dizer em que
                          // pé está o envio. O fundo translúcido mantém a mesma
                          // leitura de "ainda não confirmada" e devolve o texto.
                          item.failed ? "bg-danger-soft text-danger" : "bg-accent-soft/60 text-ink",
                        )}
                      >
                        {item.body}
                        {item.failed ? null : (
                          /* O estado da bolha é o feedback do envio — por isso
                             não existe toast de sucesso. */
                          <span
                            aria-live="polite"
                            className="float-right mt-1 ml-2 flex items-center gap-1 text-meta whitespace-nowrap text-ink-secondary"
                          >
                            <Clock className="size-3 shrink-0" aria-hidden />
                            Enviando…
                          </span>
                        )}
                      </div>
                      {item.failed ? (
                        <div className="mt-1 flex justify-end gap-2 text-caption">
                          <button type="button" className="text-accent" onClick={() => deliver(item)}>
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
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              {/* Volta ao fim sem rolar a mão. O contador diz o que chegou
                  enquanto se lia o histórico — que é exatamente o que a rolagem
                  forçada escondia ao arrastar todo mundo para baixo. */}
              {longeDoFim ? (
                <button
                  data-descer
                  type="button"
                  onClick={descerAoFim}
                  aria-label={
                    naoVistas > 0
                      ? `Descer para a última mensagem (${naoVistas} nova${naoVistas > 1 ? "s" : ""})`
                      : "Descer para a última mensagem"
                  }
                  className="absolute right-4 bottom-4 z-10 flex h-10 items-center gap-1.5 rounded-pill border border-line bg-surface-raised px-3 text-label text-ink shadow-[var(--shadow-overlay)] transition-colors hover:bg-surface-sunken"
                >
                  <ChevronDown className="size-4 shrink-0" aria-hidden />
                  {naoVistas > 0 ? (
                    <span className="tabular">{naoVistas > 99 ? "99+" : naoVistas}</span>
                  ) : null}
                </button>
              ) : null}
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
                onEnviar={registrarEnvio}
                onSent={() => void reload(detail.conversationId)}
              />
              {detail.hasWhatsapp ? (
                /* Só onde Enter de fato envia: no teclado virtual ele quebra a
                   linha, e a frase virava uma linha inútil na tela menor. */
                <p className="mx-auto mt-1.5 hidden max-w-[680px] text-meta text-ink-secondary md:block">
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
  const previa = previaDaConversa(conversation);
  const daCasa = !conversation.lastMessageInbound;
  const PreviaIcon = MEDIA_ICON[conversation.lastMessageType ?? "text"];

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
              {horaDaLista(conversation.lastMessageAt)}
            </span>
          ) : null}
        </span>

        <span className="mt-0.5 flex items-center gap-1.5">
          {/* O tique é o de verdade, com o status da última mensagem. Antes era
              um <Check> cinza fixo: uma mensagem que FALHOU ficava idêntica a
              uma entregue, e ninguém reenviava porque nada dizia que precisava. */}
          {daCasa && conversation.lastMessageAt ? (
            <span className="flex shrink-0 items-center text-ink-tertiary">
              <DeliveryTick status={conversation.lastMessageStatus ?? "sent"} />
            </span>
          ) : null}
          {PreviaIcon ? <PreviaIcon className="size-3 shrink-0 text-ink-tertiary" aria-hidden /> : null}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-caption",
              naoLidas > 0 ? "text-ink" : "text-ink-secondary",
            )}
          >
            {/* "Você:" separa num relance o que a clínica respondeu do que a
                cliente ainda está esperando resposta. */}
            {daCasa && conversation.lastMessageAt ? <span className="text-ink-tertiary">Você: </span> : null}
            {previa.texto}
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
