"use client";

import {
  ArrowLeftRight,
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
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";
import { useFuso } from "@/lib/fuso";
import { formatTz } from "@/lib/tz";
import { horaDaLista } from "./relogio";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
import { previaDaConversa } from "./previa";
import {
  type InboxDetail,
  listConversationsAction,
  syncPhotosAction,
  loadConversationAction,
  sendMessageAction,
  setAiPauseAction,
  syncConversationHistoryAction,
  syncRecentInboxAction,
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
  /** O que o aparelho sabe desta conversa. Reserva, nunca verdade. */
  providerPreview: string | null;
  providerPreviewType: string | null;
  providerLastAt: string | null;
  providerUnread: number | null;
  /** A maior entre a nossa data e a do aparelho — é ela que ordena a lista. */
  lastActivityAt: string | null;
  assignedUserId: number | null;
  assignedUserName: string | null;
  lastAssignedUserName: string | null;
  photoUrl: string | null;
};

type Tab = "meus" | "fila" | "todos" | "resolvidas";
type AssignmentAction = "assumir" | "transferir" | "devolver" | "resolver" | "reabrir";
type AssigneeFilter = "all" | "unassigned" | `user:${number}`;
type InboxAssignee = { userId: number; name: string; role: "owner" | "admin" | "staff" };

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
  { id: "resolvidas", label: "Finalizadas", icon: CheckCircle2 },
];

function assigneeFromFilter(filter: AssigneeFilter): "all" | "unassigned" | number {
  if (filter === "all" || filter === "unassigned") return filter;
  return Number(filter.slice("user:".length));
}

/** Grafia dos canais: "whatsapp" nunca deve virar "Whatsapp" via CSS. */
const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  site: "Site",
};

/** Rede ou proxy podem interromper SSE; esta varredura é apenas a rede de segurança. */
const FALLBACK_POLL_MS = 30_000;

/** Chave do retrato: as conversas abertas inteiras, antes de qualquer recorte. */
const CHAVE_DAS_ABERTAS = "abertas";

/** Sempre o MESMO array vazio: um literal novo a cada render reaqueceria a lista. */
const SEM_LINHAS: ConversationItem[] = [];

/** Identidade de uma consulta que o servidor precisa responder recortada. */
function chaveDaConsulta(tab: Tab, search: string, assignee: AssigneeFilter): string {
  return `${tab}|${search}|${tab === "todos" ? assignee : "all"}`;
}

/**
 * Meus, Fila e Todos a partir do MESMO conjunto.
 *
 * As três abas são conversas abertas recortadas por quem é o dono: "Meus" é o
 * que está comigo, "Fila" o que não tem dono, "Todos" tudo. Recortar aqui é o
 * que torna a troca de aba instantânea — antes cada clique refazia a consulta
 * no servidor para receber um subconjunto do que já estava na tela.
 */
function fatiarAbertas(
  abertas: ConversationItem[],
  tab: Tab,
  assignee: AssigneeFilter,
  currentUserId: number,
): ConversationItem[] {
  const daAba = abertas.filter((c) =>
    tab === "meus" ? c.assignedUserId === currentUserId : tab === "fila" ? c.assignedUserId == null : true,
  );
  if (tab !== "todos" || assignee === "all") return daAba;
  if (assignee === "unassigned") return daAba.filter((c) => c.assignedUserId == null);
  const userId = Number(assignee.slice("user:".length));
  return daAba.filter((c) => c.assignedUserId === userId);
}

export function InboxView({
  conversations,
  initialScope,
  retratoCompleto,
  counts,
  initialDetail,
  initialSelectedId,
  initialTab,
  currentUserId,
  assignees,
  whatsappConnected,
  canSupervise,
  canStartConversation,
}: {
  conversations: ConversationItem[];
  /** "abertas" = a lista veio inteira e as abas se recortam aqui; "aba" = já veio recortada. */
  initialScope: "abertas" | "aba";
  /**
   * A caixa cabe no teto de linhas. Vem separado do escopo porque abrir direto
   * em "Finalizadas" também devolve escopo "aba" — e isso não diz nada sobre o
   * tamanho da caixa de conversas abertas.
   */
  retratoCompleto: boolean;
  counts: { meus: number; fila: number; todos: number };
  initialDetail: InboxDetail | null;
  initialSelectedId: number | null;
  initialTab: Tab;
  currentUserId: number;
  assignees: InboxAssignee[];
  whatsappConnected: boolean;
  canSupervise: boolean;
  /** Iniciar conversa é ação de staff; profissional não vê o botão. */
  canStartConversation: boolean;
}) {
  const fuso = useFuso();
  const [tab, setTab] = useState<Tab>(initialTab);
  /** O que está digitado na busca. */
  const [termo, setTermo] = useState("");
  /** O que já virou consulta — atrasado em 300 ms para não pedir por tecla. */
  const [search, setSearch] = useState("");
  /**
   * O que o servidor devolveu, guardado por consulta.
   *
   * A chave "abertas" guarda TODAS as conversas abertas de uma vez: Meus, Fila
   * e Todos são fatias dela e a troca entre as três não custa nenhuma ida ao
   * servidor. As outras chaves são as perguntas que o retrato não responde —
   * a busca (que procura a caixa inteira, não as 100 linhas carregadas) e
   * Finalizadas (status disjunto) — e ficam guardadas como cache: voltar para
   * Finalizadas pinta na hora e revalida por baixo.
   */
  const [listas, setListas] = useState<Record<string, ConversationItem[]>>(() => ({
    [initialScope === "abertas" ? CHAVE_DAS_ABERTAS : chaveDaConsulta(initialTab, "", "all")]: conversations,
  }));
  /**
   * Falso quando há mais conversas abertas do que o teto de linhas da lista.
   * Aí o retrato é parcial e fatiar aqui MENTIRIA sobre o tamanho de cada aba:
   * o servidor volta a responder aba por aba, como antes.
   */
  const [retratoServe, setRetratoServe] = useState(retratoCompleto);
  const [tabCounts, setTabCounts] = useState(counts);
  /** Na visão Todos, permite acompanhar uma pessoa sem criar outra aba. */
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>("all");
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
  /** Uma sequência POR consulta: respostas de perguntas diferentes não se anulam. */
  const listReqRef = useRef<Record<string, number>>({});
  const requestRef = useRef<number | null>(null);
  /** Botão de descer + contador do que chegou enquanto se lia o histórico. */
  const [longeDoFim, setLongeDoFim] = useState(false);
  const [naoVistas, setNaoVistas] = useState(0);
  const pertoDoFimRef = useRef(true);
  const conversaRolada = useRef<number | null>(null);
  const totalRenderizado = useRef(0);

  /**
   * O que a lista mostraria para uma pergunta — ou nulo, se ainda não sabemos.
   *
   * Uma função só, usada tanto para pintar quanto para decidir, na hora do
   * clique, se a aba pedida já tem resposta na memória. Busca e Finalizadas vão
   * ao servidor; as três abas de conversa aberta saem do retrato — zero
   * requisição, zero espera.
   */
  /** Sob qual chave a resposta desta pergunta é guardada. */
  const chaveGuardada = useCallback(
    (proxTab: Tab, term: string, proxAssignee: AssigneeFilter): string =>
      retratoServe && !term && proxTab !== "resolvidas"
        ? CHAVE_DAS_ABERTAS
        : chaveDaConsulta(proxTab, term, proxAssignee),
    [retratoServe],
  );
  const linhasPara = useCallback(
    (proxTab: Tab, term: string, proxAssignee: AssigneeFilter): ConversationItem[] | null => {
      const chave = chaveGuardada(proxTab, term, proxAssignee);
      const linhas = listas[chave];
      if (linhas == null) return null;
      return chave === CHAVE_DAS_ABERTAS ? fatiarAbertas(linhas, proxTab, proxAssignee, currentUserId) : linhas;
    },
    [listas, chaveGuardada, currentUserId],
  );
  const listaOuNulo = useMemo(
    () => linhasPara(tab, search, assigneeFilter),
    [linhasPara, tab, search, assigneeFilter],
  );
  /** Nada guardado para esta pergunta: a resposta ainda está a caminho. */
  const listaCarregando = listaOuNulo === null;
  const list = listaOuNulo ?? SEM_LINHAS;

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
   * Pergunta a lista ao servidor e guarda a resposta na chave certa.
   *
   * A guarda de sequência não é preciosismo: sem ela, a resposta de uma
   * requisição antiga chegando depois de uma nova reescreve a lista com o
   * filtro errado. Foi reproduzido — clicar numa aba logo após a varredura
   * disparar deixava as conversas da aba anterior na tela por dez segundos, e
   * clicar numa delas abria conversa que não pertencia ao filtro. A sequência é
   * POR consulta: uma busca e uma revalidação do retrato correm juntas sem uma
   * cancelar a outra, senão a chave da perdedora ficava eternamente vazia e a
   * lista pulsava para sempre.
   */
  const carregarLista = useCallback(
    async (
      nextTab: Tab,
      term: string,
      nextAssignee: AssigneeFilter,
    ): Promise<ConversationItem[] | null> => {
      const pedido = chaveDaConsulta(nextTab, term, nextAssignee);
      const meu = (listReqRef.current[pedido] = (listReqRef.current[pedido] ?? 0) + 1);
      const resultado = await listConversationsAction({
        tab: nextTab,
        search: term || undefined,
        assignee: nextTab === "todos" ? assigneeFromFilter(nextAssignee) : "all",
      });
      if (listReqRef.current[pedido] !== meu) return null;
      if (!resultado.ok) {
        toast.error(resultado.error);
        return null;
      }
      const linhas = resultado.rows as ConversationItem[];
      // Busca e Finalizadas SEMPRE voltam recortadas; deixá-las decidir se o
      // retrato serve derrubaria o caminho rápido das outras abas só porque
      // alguém digitou uma letra na busca.
      if (!term && nextTab !== "resolvidas") setRetratoServe(resultado.escopo === "abertas");
      const chave = resultado.escopo === "abertas" ? CHAVE_DAS_ABERTAS : pedido;
      setListas((prev) => {
        // Termo de busca velho não vale cache: só a consulta em curso e as que
        // não dependem do que está digitado sobrevivem.
        const guardadas = Object.fromEntries(
          Object.entries(prev).filter(([k]) => k === CHAVE_DAS_ABERTAS || k.split("|")[1] === ""),
        );
        return { ...guardadas, [chave]: linhas };
      });
      // Os contadores viajam junto: antes eles vinham só no carregamento da
      // página e "Fila 3" continuava 3 enquanto chegavam mais dez.
      setTabCounts(resultado.counts);
      // Devolve o que a ABA pediu, já recortado: quem chamou quer saber o que
      // vai aparecer, não o conjunto inteiro de onde isso saiu.
      return resultado.escopo === "abertas"
        ? fatiarAbertas(linhas, nextTab, nextAssignee, currentUserId)
        : linhas;
    },
    [currentUserId],
  );

  const lastProviderSyncRef = useRef<{ conversationId: number; at: number } | null>(null);
  const lastRecentSyncRef = useRef(0);

  /**
   * O que o canal de eventos precisa LER fica em refs, atualizadas a cada
   * render. O efeito abaixo dependia de `tab`, `search` e `activeId` — o que
   * significava que CADA TOQUE numa conversa derrubava o EventSource, o
   * `ready` da reconexão disparava a sincronização completa (histórico na
   * uazapi incluído, uma viagem à rede externa) e a abertura da conversa
   * entrava na fila atrás de tudo isso. Medido: 1,3s para trocar de tela.
   * Com o canal estável, o toque não paga nada além da própria conversa.
   */
  const tabRef = useRef(tab);
  const searchRef = useRef(search);
  const assigneeRef = useRef(assigneeFilter);
  const activeIdRef = useRef(activeId);
  const guardarConversaRef = useRef(guardarConversa);
  const cacheRef = useRef(cache);

  /** Recarrega a consulta que está na tela — a única que interessa agora. */
  const revalidar = useCallback(
    () => carregarLista(tabRef.current, searchRef.current, assigneeRef.current),
    [carregarLista],
  );
  const revalidarRef = useRef(revalidar);

  useEffect(() => {
    tabRef.current = tab;
    searchRef.current = search;
    assigneeRef.current = assigneeFilter;
    activeIdRef.current = activeId;
    guardarConversaRef.current = guardarConversa;
    cacheRef.current = cache;
    revalidarRef.current = revalidar;
  });

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
        // O banco primeiro: é o que muda a tela. A reconciliação com a uazapi
        // (rede externa, meio segundo fácil) vem DEPOIS da pintura — se ela
        // importar algo, o próprio evento publicado reabre este ciclo.
        const ativa = activeIdRef.current;
        if (ativa) {
          const loaded = await loadConversationAction(ativa, { markRead: false });
          if (loaded && activeIdRef.current === ativa) guardarConversaRef.current(ativa, loaded);
        }
        await revalidarRef.current();
        if (Date.now() - lastRecentSyncRef.current >= FALLBACK_POLL_MS) {
          lastRecentSyncRef.current = Date.now();
          await syncRecentInboxAction();
        }
        if (ativa && activeIdRef.current === ativa) {
          const last = lastProviderSyncRef.current;
          if (!last || last.conversationId !== ativa || Date.now() - last.at >= FALLBACK_POLL_MS) {
            lastProviderSyncRef.current = { conversationId: ativa, at: Date.now() };
            await syncConversationHistoryAction(ativa);
          }
        }
      } while (queued);
      syncing = false;
    };

    const events = new EventSource("/api/inbox/events");
    events.addEventListener("ready", () => void sync());
    events.onmessage = (evento) => {
      // O evento diz QUAL conversa mudou. Sem olhar isso, uma mensagem
      // chegando numa conversa fechada fazia toda aba recarregar a conversa
      // aberta inteira além da lista — 51 KB por evento, multiplicado por
      // cada atendente com a tela aberta. Agora a conversa só é relida quando
      // é ela que mudou; a lista sempre, porque a prévia e a ordem mudam.
      let alvo: number | undefined;
      try {
        alvo = (JSON.parse(evento.data) as { conversationId?: number }).conversationId;
      } catch {
        alvo = undefined;
      }
      if (alvo != null && activeIdRef.current != null && alvo !== activeIdRef.current) {
        void revalidarRef.current();
        return;
      }
      void sync();
    };

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
    // Montado UMA vez: o estado vivo chega pelas refs. Colocar tab/search/
    // activeId aqui de volta reintroduz o custo de reconexão em cada toque.
  }, []);

  /**
   * Busca com respiro de 300 ms.
   *
   * "mariana" disparava sete consultas ao servidor, uma por tecla, e as seis
   * primeiras eram jogadas fora pela guarda de sequência — trabalho puro de
   * banco por letra digitada.
   */
  const montou = useRef(false);
  const termoAplicado = useRef("");
  useEffect(() => {
    if (!montou.current) {
      // A primeira lista já veio renderizada pelo servidor; repetir a consulta
      // no mount seria uma ida à toa em toda abertura do inbox.
      montou.current = true;
      return;
    }
    // O efeito também acorda quando a aba muda (a consulta depende dela), e aí
    // o termo continua o mesmo: sem esta guarda, trocar de aba disparava a
    // consulta DUAS vezes — uma pelo botão, outra por este temporizador.
    if (termoAplicado.current === termo) return;
    const timer = setTimeout(() => {
      termoAplicado.current = termo;
      setSearch(termo);
      // A busca procura a caixa inteira, não as 100 linhas carregadas: é
      // pergunta de servidor. Disparar daqui, e não de um efeito sobre
      // `search`, evita o quadro extra de renderização entre uma coisa e outra.
      if (linhasPara(tab, termo, assigneeFilter) == null) void carregarLista(tab, termo, assigneeFilter);
    }, 300);
    return () => clearTimeout(timer);
  }, [termo, tab, assigneeFilter, linhasPara, carregarLista]);

  /**
   * Trocar de aba é só trocar de recorte.
   *
   * A lista pinta no mesmo quadro: as três abas de conversa aberta saem do
   * retrato que já está na memória, sem nenhuma ida ao servidor. Só quando a
   * pergunta não cabe no retrato (Finalizadas, busca, caixa grande) é que há
   * uma consulta — e mesmo aí ela não bloqueia nada além da própria lista.
   *
   * Abrir a primeira conversa acontece DEPOIS, e nunca antes: era o segundo
   * elo da corrente que a atendente esperava para ver a aba trocar.
   */
  function trocarPergunta(next: Tab, proxAssignee: AssigneeFilter) {
    const prontas = linhasPara(next, search, proxAssignee);
    if (prontas) {
      abrirPrimeiraDaAba(prontas);
      // Pintou do que estava guardado. Se a resposta guardada NÃO é a que a
      // varredura de 30s vinha atualizando — voltar de "Finalizadas" para as
      // abertas, por exemplo —, ela é de quando a atendente saiu dali e pode
      // estar velha ao lado de um crachá recém-atualizado. Revalida por baixo,
      // sem segurar a pintura. Entre Meus, Fila e Todos a chave é a MESMA, e aí
      // continua sendo zero requisição.
      if (chaveGuardada(next, search, proxAssignee) !== chaveGuardada(tab, search, assigneeFilter)) {
        void carregarLista(next, search, proxAssignee).catch(() => undefined);
      }
      return;
    }
    const pedido = chaveDaConsulta(next, search, proxAssignee);
    void carregarLista(next, search, proxAssignee)
      .then((linhas) => {
        // A resposta pode chegar depois de outro clique. A guarda de sequência
        // do `carregarLista` é POR consulta e não cobre isto: a resposta de
        // "Finalizadas" continua válida como lista, mas abrir a primeira dela
        // enquanto a tela já mostra "Meus" põe no painel uma conversa que não
        // está — nem pode estar — na lista ao lado. Reproduzido clicando
        // "Finalizadas" e "Meus" em seguida: a aba dizia Meus, a URL apontava
        // para uma conversa finalizada e nenhuma linha ficava marcada.
        if (chaveDaConsulta(tabRef.current, searchRef.current, assigneeRef.current) !== pedido) return;
        if (linhas) abrirPrimeiraDaAba(linhas);
      })
      // Segundo plano de verdade: rede caída aqui virava rejeição não tratada.
      .catch(() => undefined);
  }

  function changeTab(next: Tab) {
    setTab(next);
    // A ref anda junto com o estado, e não só no efeito pós-render: quem
    // responder daqui a meio segundo precisa saber AGORA qual é a pergunta na
    // tela, senão a comparação acima compararia com a aba anterior.
    tabRef.current = next;
    trocarPergunta(next, assigneeFilter);
  }

  function changeAssignee(next: AssigneeFilter) {
    setAssigneeFilter(next);
    assigneeRef.current = next;
    trocarPergunta("todos", next);
  }

  function syncUrl(id: number | null) {
    window.history.replaceState(null, "", id ? `/inbox?conversa=${id}` : "/inbox");
  }

  /**
   * Aquece o cache de uma conversa sem nenhum efeito colateral visível.
   *
   * É o que faz o toque parecer instantâneo: o detalhe já chegou antes do
   * clique (pelo pouso do mouse na linha, ou pelo aquecimento das primeiras da
   * lista). `markRead: false` é obrigatório — pré-carregar não é ler, e zerar
   * o contador aqui apagaria o "1 nova" de uma conversa que ninguém abriu.
   */
  const prefetchRef = useRef<Set<number>>(new Set());
  const prefetch = useCallback(
    (id: number): Promise<void> => {
      // `requestRef` cobre a conversa que um clique já está carregando:
      // aquecer atrás do open() só enfileiraria uma segunda leitura idêntica.
      if (cacheRef.current[id] || prefetchRef.current.has(id) || requestRef.current === id) {
        return Promise.resolve();
      }
      prefetchRef.current.add(id);
      return loadConversationAction(id, { markRead: false })
        .then((loaded) => {
          if (loaded) guardarConversaRef.current(id, loaded);
        })
        // Aquecer é melhor esforço: rede caída aqui não pode virar erro não
        // tratado — o clique de verdade tem o próprio tratamento, e a
        // varredura periódica repara o que faltar.
        .catch(() => undefined)
        .finally(() => prefetchRef.current.delete(id));
    },
    [],
  );

  /**
   * Aquece a aba onde o ponteiro pousou.
   *
   * Meus, Fila e Todos saem do retrato que já está na memória e não pedem
   * nada. Sobra "Finalizadas", a única pergunta que ainda viaja ao servidor:
   * medida em produção, 488ms de "Carregando conversas…" na primeira visita.
   * Buscar no pouso do ponteiro cobre esse intervalo com o tempo que a mão
   * leva entre parar e clicar.
   *
   * Os mesmos 120ms das linhas, e pela mesma razão: server action sai numa
   * fila única, então aquecer QUALQUER aba atravessada poria trabalho
   * especulativo na frente do próximo clique. Só aquece onde o ponteiro parou,
   * e só o que ainda não sabemos responder.
   */
  const abaQuente = useRef<ReturnType<typeof setTimeout> | null>(null);
  const desarmarAba = useCallback(() => {
    if (abaQuente.current) {
      clearTimeout(abaQuente.current);
      abaQuente.current = null;
    }
  }, []);
  const armarAba = useCallback(
    (alvo: Tab) => {
      desarmarAba();
      if (alvo === tab || linhasPara(alvo, search, assigneeFilter) != null) return;
      abaQuente.current = setTimeout(() => {
        void carregarLista(alvo, search, assigneeFilter).catch(() => undefined);
      }, 120);
    },
    [desarmarAba, tab, search, assigneeFilter, linhasPara, carregarLista],
  );
  // Um temporizador pendente ao desmontar chamaria server action de tela que
  // já saiu.
  useEffect(() => desarmarAba, [desarmarAba]);

  /** O primeiro alvo de toque é o topo da lista: chega aquecido. */
  useEffect(() => {
    const primeiras = list.slice(0, 6).map((c) => c.id);
    let cancelado = false;
    const timer = setTimeout(async () => {
      // UMA de cada vez, de propósito: as server actions saem do cliente numa
      // fila única e sequencial. Despachar as seis de uma vez punha ~2,5s de
      // aquecimento NA FRENTE do clique da atendente — medido: 3,5s de
      // esqueleto num toque dado durante o aquecimento. Em série, o clique
      // espera no máximo a leitura que já estiver no ar.
      for (const id of primeiras) {
        if (cancelado) return;
        await prefetch(id);
      }
    }, 350);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [list, prefetch]);

  /**
   * Reconciliação com a uazapi em segundo plano, por conversa, com respiro.
   * Fora do caminho do toque de propósito: é uma viagem à rede externa, e
   * bloquear a troca de tela nela foi exatamente o que deixou o Inbox lento.
   */
  const sincronizarHistoricoEmFundo = useCallback((id: number) => {
    const last = lastProviderSyncRef.current;
    if (last && last.conversationId === id && Date.now() - last.at < FALLBACK_POLL_MS) return;
    lastProviderSyncRef.current = { conversationId: id, at: Date.now() };
    void syncConversationHistoryAction(id)
      .then((r) => {
        if (r.imported > 0 && activeIdRef.current === id) {
          return loadConversationAction(id, { markRead: false }).then((loaded) => {
            if (loaded && activeIdRef.current === id) guardarConversaRef.current(id, loaded);
          });
        }
      })
      // Segundo plano de verdade: rede caída aqui virava rejeição não tratada
      // no console. A varredura de 30s tenta de novo sozinha.
      .catch(() => undefined);
  }, []);

  function open(id: number, { marcarLida = true }: { marcarLida?: boolean } = {}) {
    setSelectedId(id);
    syncUrl(id);
    // Pelo mesmo motivo da `key` do Composer: o alvo de resposta é estado desta
    // tela e sobreviveria à troca, fazendo a mensagem sair citando a fala de
    // outra cliente.
    setReply(null);
    // Abrir zera o não lido; refletir na hora evita o contador fantasma. Zera
    // os DOIS contadores porque o crachá mostra o maior deles — apagar só o
    // nosso deixava o número do aparelho na tela de uma conversa já aberta.
    if (marcarLida) {
      setListas((prev) => {
        const zerado = (c: ConversationItem) =>
          c.id === id ? { ...c, unreadCount: 0, providerUnread: 0 } : c;
        return Object.fromEntries(Object.entries(prev).map(([chave, linhas]) => [chave, linhas.map(zerado)]));
      });
    }
    requestRef.current = id;
    const jaAquecida = Boolean(cacheRef.current[id]);
    startSwitching(async () => {
      // Aquecida pinta na hora; a releitura corre por fora só para zerar o não
      // lido no servidor e trazer o que chegou depois do aquecimento.
      const loaded = await loadConversationAction(id, { markRead: marcarLida });
      if (requestRef.current !== id) return;
      if (loaded) guardarConversa(id, loaded);
      else if (!jaAquecida) {
        // Sem detalhe e sem cache não há o que desenhar: sem este recuo o
        // esqueleto ficava pulsando para sempre — no celular sem nem botão de
        // voltar — porque a varredura periódica não repara conversa que o
        // servidor não devolve (id apagado, por exemplo).
        toast.error("Não foi possível abrir a conversa.");
        setSelectedId(null);
        syncUrl(null);
      }
    });
    /**
     * Reconciliar com a uazapi é viagem à rede externa, e as server actions
     * saem do cliente numa fila ÚNICA e sequencial: enfileirá-la aqui atrasa
     * TUDO que vier depois — medido, uma troca para "Finalizadas" logo em
     * seguida ficava segundos parada esperando esta chamada terminar.
     *
     * Só quem a atendente abriu de propósito paga isso. Conversa escolhida
     * pela aba (marcarLida: false) não: a varredura de 30 s reconcilia a
     * conversa aberta de qualquer forma.
     */
    if (marcarLida) sincronizarHistoricoEmFundo(id);
  }

  /**
   * A conversa que a aba escolhe quando a atendente não escolheu nenhuma.
   *
   * No desktop os dois painéis convivem, e sem isto trocar de aba deixava
   * metade da tela em "Escolha uma conversa" com a lista cheia ao lado. Só
   * roda a partir de uma troca de aba ou de responsável — nunca a partir de
   * uma varredura periódica: uma conversa que saísse da aba porque outra
   * pessoa a assumiu faria a tela pular sozinha no meio de uma leitura.
   *
   * `marcarLida: false` porque ninguém escolheu esta conversa — a aba escolheu
   * por ela. Marcar lida aqui apagava o não lido da primeira da Fila só porque
   * alguém clicou na aba, e esse número é como a clínica sabe quem espera.
   */
  function abrirPrimeiraDaAba(linhas: ConversationItem[]) {
    // No celular a lista É a tela: abrir por conta própria tiraria a atendente
    // de onde ela está.
    if (!doisPaineis) return;
    if (linhas.length === 0) {
      setSelectedId(null);
      syncUrl(null);
      return;
    }
    if (linhas.some((c) => c.id === activeIdRef.current)) return;
    open(linhas[0].id, { marcarLida: false });
  }

  async function reload(conversationId: number) {
    const loaded = await loadConversationAction(conversationId);
    if (loaded) guardarConversa(conversationId, loaded);
    await revalidar();
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


  function assignmentFor(conversationId: number, action: AssignmentAction, targetUserId?: number) {
    startActing(async () => {
      const result = await updateAssignmentAction({ conversationId, action, targetUserId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      // Atualiza o detalhe apenas se a ação foi feita na conversa aberta. A
      // linha já será relida abaixo; abrir cada conversa só para transferi-la
      // transformaria um clique rápido em duas consultas desnecessárias.
      if (conversationId === activeId) {
        const loaded = await loadConversationAction(conversationId, { markRead: false });
        if (loaded) guardarConversa(conversationId, loaded);
      }
      await revalidar();

      const targetName = assignees.find((person) => person.userId === targetUserId)?.name;
      toast.success(
        action === "assumir"
          ? "Conversa assumida"
          : action === "transferir"
            ? `Conversa transferida${targetName ? ` para ${targetName}` : ""}`
          : action === "devolver"
            ? "Conversa devolvida para a fila"
            : action === "resolver"
              ? "Conversa resolvida"
              : "Conversa reaberta",
      );
    });
  }

  function assignment(action: Exclude<AssignmentAction, "transferir">) {
    if (detail) assignmentFor(detail.conversationId, action);
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
                // A conversa recém-criada É a escolha: `open` acontece aqui e
                // a lista chega depois, sem ninguém trocar a conversa por baixo
                // — a abertura automática só age em troca de aba.
                setTab("meus");
                setTermo("");
                setSearch("");
                setAssigneeFilter("all");
                open(conversationId);
                void carregarLista("meus", "", "all");
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
                  onPointerEnter={() => armarAba(item.id)}
                  onPointerLeave={desarmarAba}
                  onFocus={() => armarAba(item.id)}
                  onBlur={desarmarAba}
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

          {tab === "todos" ? (
            <label className="flex items-center gap-2 text-caption text-ink-secondary">
              <span className="shrink-0">Ver conversas de</span>
              <Select
                size="sm"
                value={assigneeFilter}
                onChange={(event) => changeAssignee(event.target.value as AssigneeFilter)}
                className="min-w-0"
                aria-label="Filtrar conversas por atendente"
              >
                <option value="all">Toda a equipe</option>
                <option value="unassigned">Sem atendente</option>
                {assignees.map((person) => (
                  <option key={person.userId} value={`user:${person.userId}`}>
                    {person.userId === currentUserId ? "Eu mesmo" : person.name}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
        </div>

        {list.length === 0 ? (
          <p className="px-4 py-8 text-center text-caption text-ink-secondary">
            {/* Lista vazia e lista a caminho são coisas diferentes: dizer
                "nenhuma conversa" enquanto a resposta viaja faz a atendente
                acreditar numa fila vazia que não está vazia. */}
            {listaCarregando
              ? "Carregando conversas…"
              : tab === "fila"
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
                  onPrefetch={() => prefetch(conversation.id)}
                  currentUserId={currentUserId}
                  assignees={assignees}
                  pending={acting}
                  onAssignment={(action, targetUserId) =>
                    assignmentFor(conversation.id, action, targetUserId)
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* Conversa */}
      <section className={cn("min-w-0 flex-1 flex-col bg-surface md:flex", selectedId == null ? "hidden" : "flex")}>
        {detail == null ? (
          loading ? (
            // O esqueleto herda nome e foto da linha tocada: a tela muda no
            // instante do toque, e o que falta chegar são só as bolhas. Um
            // painel vazio com "Carregando…" fazia um toque de meio segundo
            // parecer travado.
            <ConversationSkeleton row={list.find((c) => c.id === activeId) ?? null} />
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={MessageSquare}
                title="Escolha uma conversa"
                description="As conversas do WhatsApp aparecem à esquerda, com o histórico do cliente ao lado."
              />
            </div>
          )
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
                ) : (
                  <>
                    {!mine ? (
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
                    ) : null}
                    <TransferControl
                      assignees={assignees}
                      currentUserId={currentUserId}
                      assignedUserId={detail.assignedUserId}
                      pending={acting}
                      showLabel
                      onTransfer={(targetUserId) =>
                        assignmentFor(detail.conversationId, "transferir", targetUserId)
                      }
                      onQueue={() => assignment("devolver")}
                    />
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
                    const trocouODia =
                      !anterior || !mesmoDia(anterior.createdAt, message.createdAt, fuso);
                    return (
                      <Fragment key={message.id}>
                        {trocouODia ? <SeparadorDeData iso={message.createdAt} /> : null}
                        <MessageBubble
                          message={message}
                          conversationId={detail.conversationId}
                          agrupada={!trocouODia && mesmoGrupo(anterior, message, fuso)}
                          ultimaDoGrupo={!seguinte || !mesmoGrupo(message, seguinte, fuso)}
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
  const fuso = useFuso();
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
              ? formatTz(new Date(context.lastVisitAt), fuso, "dd/MM/yy")
              : "—"
          }
          tone="text-info"
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-meta font-medium tracking-wide text-ink-secondary uppercase">
            Agendamentos ({context.appointmentsCount})
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
            Nenhum agendamento registrado.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {context.nextAppointments.map((item) => (
              <li key={item.id} className="rounded-control border border-line px-2.5 py-2">
                <p className="truncate text-label text-ink">{item.serviceName}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-caption text-ink-secondary">
                  <span className="tabular">
                    {formatTz(new Date(item.startsAt), fuso, "dd/MM 'às' HH:mm")}
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

/**
 * Painel da conversa antes de as mensagens chegarem.
 *
 * O cabeçalho é real (nome, foto e telefone já estão na linha da lista); só as
 * bolhas são promessa. As larguras variadas e os lados alternados imitam a
 * silhueta de uma conversa de verdade — um retângulo único no meio da tela
 * lê-se como defeito, não como carregamento.
 */
function ConversationSkeleton({ row }: { row: ConversationItem | null }) {
  const larguras = ["w-[46%]", "w-[30%]", "w-[58%]", "w-[24%]", "w-[40%]"];
  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-raised px-3 py-2 md:px-5 md:py-3">
        {row ? <Avatar name={row.customerName} src={row.photoUrl} size="lg" /> : <span className="size-10 animate-pulse rounded-full bg-surface-sunken" />}
        <div className="min-w-0 flex-1">
          {row ? (
            <>
              <h2 className="truncate text-card text-ink">{row.customerName}</h2>
              <p className="truncate text-caption text-ink-secondary">{row.phone ?? "WhatsApp"}</p>
            </>
          ) : (
            <span className="block h-4 w-40 animate-pulse rounded-control bg-surface-sunken" />
          )}
        </div>
      </header>
      <div aria-hidden className="flex flex-1 flex-col justify-end gap-2 overflow-hidden px-4 py-4 md:px-6">
        {larguras.map((w, i) => (
          <span
            key={w}
            className={cn(
              "h-9 animate-pulse rounded-card bg-surface-sunken",
              w,
              i % 2 === 0 ? "self-start" : "self-end",
            )}
            style={{ animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>
      <div className="shrink-0 border-t border-line bg-surface-raised px-3 py-3 md:px-6">
        <span className="block h-10 animate-pulse rounded-card bg-surface-sunken" />
      </div>
    </>
  );
}

function ConversationRow({
  conversation,
  active,
  opened,
  onOpen,
  onPrefetch,
  currentUserId,
  assignees,
  pending,
  onAssignment,
}: {
  conversation: ConversationItem;
  active: boolean;
  opened: boolean;
  onOpen: () => void;
  /** Pousar o mouse já busca a conversa: quando o clique vem, ela está pronta. */
  onPrefetch: () => void;
  currentUserId: number;
  assignees: InboxAssignee[];
  pending: boolean;
  onAssignment: (action: AssignmentAction, targetUserId?: number) => void;
}) {
  const fuso = useFuso();
  /**
   * Não lidas: o MAIOR entre o nosso contador e o do aparelho.
   *
   * O nosso só conta o que passou pelo webhook — nesta conta havia conversa com
   * 27 esperando no telefone e 6 aqui, porque nada anterior à conexão chegou
   * por aqui. O do aparelho, por sua vez, não sabe do que já foi lido só nesta
   * tela. Nenhum dos dois inventa mensagem, então o maior é o único que nunca
   * esconde alguém esperando resposta; abrir a conversa zera os dois, e por
   * isso o crachá não ressuscita pelo retrato velho no refresh seguinte.
   */
  const naoLidas = Math.max(conversation.unreadCount, conversation.providerUnread ?? 0);
  const previa = previaDaConversa(conversation);
  const daCasa = previa.daCasa;
  const PreviaIcon = MEDIA_ICON[previa.tipo];
  const quando = conversation.lastActivityAt;

  /**
   * Pousar de verdade, não atravessar: o mouse a caminho de outra linha
   * disparava um aquecimento por linha cruzada, e como as server actions saem
   * numa fila única, o clique no destino esperava a fila inteira (medido:
   * 2,5s de esqueleto depois de varrer seis linhas frias). O respiro de 120ms
   * só aquece onde o ponteiro parou; no celular, o dedo que rola a lista
   * cancela no primeiro movimento.
   */
  const prefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armarPrefetch = () => {
    if (prefetchTimer.current) clearTimeout(prefetchTimer.current);
    prefetchTimer.current = setTimeout(onPrefetch, 120);
  };
  const desarmarPrefetch = () => {
    if (prefetchTimer.current) {
      clearTimeout(prefetchTimer.current);
      prefetchTimer.current = null;
    }
  };
  useEffect(
    () => () => {
      if (prefetchTimer.current) clearTimeout(prefetchTimer.current);
    },
    [],
  );

  return (
    <div
      className={cn(
        "flex w-full items-center border-l-[3px] transition-colors duration-[120ms]",
        "border-l-transparent hover:bg-surface-sunken",
        active && "md:border-l-accent md:bg-accent-soft md:hover:bg-accent-soft",
        opened && "border-l-accent bg-accent-soft hover:bg-accent-soft",
      )}
    >
      <button
        type="button"
        onClick={() => {
          // O clique carrega por conta própria; um aquecimento armado atrás
          // dele seria uma segunda leitura idêntica na fila.
          desarmarPrefetch();
          onOpen();
        }}
        onMouseEnter={armarPrefetch}
        onMouseLeave={desarmarPrefetch}
        onTouchStart={armarPrefetch}
        onTouchMove={desarmarPrefetch}
        onTouchEnd={desarmarPrefetch}
        aria-current={active ? "true" : undefined}
        className="flex min-w-0 flex-1 items-center gap-3 py-3 pr-1 pl-[9px] text-left"
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
            {quando ? (
              // "Hoje", "Ontem" e "qua" dependem do instante da montagem, e o
              // servidor monta antes do navegador. O fuso deixou de ser o
              // motivo — só sobra a virada da meia-noite entre uma pintura e
              // outra.
              <span suppressHydrationWarning className="shrink-0 text-meta text-ink-secondary tabular">
                {horaDaLista(quando, fuso)}
              </span>
            ) : null}
          </span>

          <span className="mt-0.5 flex items-center gap-1.5">
            {/* O tique é o de verdade, com o status da última mensagem. Antes era
              um <Check> cinza fixo: uma mensagem que FALHOU ficava idêntica a
              uma entregue, e ninguém reenviava porque nada dizia que precisava. */}
            {daCasa ? (
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
              {daCasa ? <span className="text-ink-tertiary">Você: </span> : null}
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

      <span className="flex shrink-0 items-center gap-1 pr-2">
        {conversation.status === "closed" ? (
          <QuickAction
            label="Reabrir conversa"
            disabled={pending}
            onClick={() => onAssignment("reabrir")}
          >
            <Play aria-hidden />
          </QuickAction>
        ) : (
          <>
            {conversation.assignedUserId == null ? (
              <QuickAction
                label="Assumir conversa"
                disabled={pending}
                emphasized
                onClick={() => onAssignment("assumir")}
              >
                <UserPlus aria-hidden />
              </QuickAction>
            ) : (
              <TransferControl
                assignees={assignees}
                currentUserId={currentUserId}
                assignedUserId={conversation.assignedUserId}
                pending={pending}
                onTransfer={(targetUserId) => onAssignment("transferir", targetUserId)}
                onQueue={() => onAssignment("devolver")}
              />
            )}
            <QuickAction
              label="Finalizar conversa"
              disabled={pending}
              onClick={() => onAssignment("resolver")}
            >
              <CheckCircle2 aria-hidden />
            </QuickAction>
          </>
        )}
      </span>
    </div>
  );
}

function QuickAction({
  label,
  disabled,
  emphasized = false,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  emphasized?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-control border transition-colors pointer-coarse:size-11 [&_svg]:size-4",
        emphasized
          ? "border-accent/25 bg-accent-soft text-accent hover:bg-accent hover:text-white"
          : "border-line bg-surface-raised text-ink-secondary hover:border-accent/30 hover:bg-accent-soft hover:text-accent",
        "disabled:pointer-events-none disabled:opacity-45",
      )}
    >
      {children}
    </button>
  );
}

/**
 * O seletor ocupa visualmente o espaço de um botão. No celular, o select
 * nativo abre a lista do sistema; no desktop, um clique mostra a equipe. Assim
 * a transferência não exige abrir a conversa nem navegar por outro painel.
 */
function TransferControl({
  assignees,
  currentUserId,
  assignedUserId,
  pending,
  showLabel = false,
  onTransfer,
  onQueue,
}: {
  assignees: InboxAssignee[];
  currentUserId: number;
  assignedUserId: number | null;
  pending: boolean;
  showLabel?: boolean;
  onTransfer: (targetUserId: number) => void;
  onQueue: () => void;
}) {
  return (
    <span
      title={assignedUserId == null ? "Atribuir conversa" : "Transferir conversa"}
      className={cn(
        "relative inline-flex items-center justify-center gap-2 rounded-control border border-line bg-surface-raised text-ink-secondary transition-colors hover:border-accent/30 hover:bg-accent-soft hover:text-accent",
        showLabel ? "h-11 px-3 text-label md:h-8" : "size-8 pointer-coarse:size-11",
        pending && "opacity-45",
      )}
    >
      <ArrowLeftRight className="size-4" aria-hidden />
      {showLabel ? <span className="hidden lg:inline">Transferir</span> : null}
      <select
        value=""
        disabled={pending}
        aria-label={assignedUserId == null ? "Atribuir conversa" : "Transferir conversa"}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "queue") onQueue();
          else if (value.startsWith("user:")) onTransfer(Number(value.slice("user:".length)));
        }}
        className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      >
        <option value="" disabled>
          {assignedUserId == null ? "Atribuir para…" : "Transferir para…"}
        </option>
        {assignees
          .filter((person) => person.userId !== assignedUserId)
          .map((person) => (
            <option key={person.userId} value={`user:${person.userId}`}>
              {person.userId === currentUserId ? "Eu mesmo" : person.name}
            </option>
          ))}
        {assignedUserId != null ? <option value="queue">Devolver para a fila</option> : null}
      </select>
    </span>
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
