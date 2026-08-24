"use client";

import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Bot,
  Check,
  CheckCheck,
  Clock,
  Contact,
  FileText,
  Image as ImageIcon,
  MapPin,
  Mic,
  TriangleAlert,
  Video,
} from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { type InboxDetail, loadMediaAction } from "./actions";
import { MessageActions } from "./message-actions";

/**
 * Uma mensagem do fio.
 *
 * Vive fora do inbox-view porque é a peça mais entrelaçada da tela — mídia,
 * citação, reação, transcrição e menu de ações no mesmo bloco — e cada mudança
 * de aparência aqui arriscava um arquivo de mil linhas que faz outras dez
 * coisas.
 */

export type Message = InboxDetail["messages"][number];

export const MEDIA_ICON: Partial<Record<string, typeof ImageIcon>> = {
  image: ImageIcon,
  video: Video,
  audio: Mic,
  ptt: Mic,
  document: FileText,
  sticker: ImageIcon,
  location: MapPin,
  contact: Contact,
};

/** Como a mensagem sem texto se anuncia — na bolha e na prévia da lista. */
export const MEDIA_LABEL: Partial<Record<string, string>> = {
  image: "Foto",
  video: "Vídeo",
  audio: "Mensagem de voz",
  ptt: "Mensagem de voz",
  document: "Documento",
  sticker: "Figurinha",
  location: "Localização",
  contact: "Contato",
  unsupported: "Mensagem não suportada",
};

/**
 * O corpo que a atendente deve ver.
 *
 * O ingestor grava `[áudio]`, `[imagem]` e afins como corpo das mensagens sem
 * texto — é marcador interno para busca e log, não frase. Imprimi-lo embaixo do
 * rótulo "Mensagem de voz" mostrava o encanamento do produto para quem só quer
 * atender.
 */
export function textoVisivel(body: string | null | undefined): string {
  const texto = (body ?? "").trim();
  return /^\[[^\]]*\]$/.test(texto) ? "" : texto;
}

/** Tamanho estimado do menu de ações — o suficiente para decidir onde ele cabe. */
const ALTURA_DO_MENU = 220;
const LARGURA_DO_MENU = 208;

/** Duas mensagens seguidas do mesmo autor, próximas no tempo, viram um bloco. */
const JANELA_DO_GRUPO_MS = 2 * 60 * 1000;

export function mesmoGrupo(anterior: Message | undefined, atual: Message): boolean {
  if (!anterior) return false;
  if (anterior.sender === "system" || atual.sender === "system") return false;
  // Apagada não entra em bloco nenhum. Ela desenha uma caixa tracejada sem
  // horário: agrupada com a de cima, a de cima perdia o `ultimaDoGrupo` e o
  // bloco inteiro ficava SEM relógio e sem tique — não dava para saber quando
  // nem se a mensagem tinha saído.
  if (anterior.deleted || atual.deleted) return false;
  if (anterior.direction !== atual.direction) return false;
  if (anterior.sender !== atual.sender) return false;
  if (anterior.senderName !== atual.senderName) return false;
  const delta = new Date(atual.createdAt).getTime() - new Date(anterior.createdAt).getTime();
  if (delta > JANELA_DO_GRUPO_MS) return false;
  return mesmoDia(anterior.createdAt, atual.createdAt);
}

export function mesmoDia(a: string, b: string): boolean {
  const um = new Date(a);
  const outro = new Date(b);
  return (
    um.getFullYear() === outro.getFullYear() &&
    um.getMonth() === outro.getMonth() &&
    um.getDate() === outro.getDate()
  );
}

/**
 * Pílula de data entre as bolhas.
 *
 * Sem ela, uma mensagem das 19:53 era seguida de outra das 08:46 sem nada no
 * meio, e a conversa parecia ter acontecido em minutos.
 */
export function SeparadorDeData({ iso }: { iso: string }) {
  const data = new Date(iso);
  const rotulo = isToday(data)
    ? "Hoje"
    : isYesterday(data)
      ? "Ontem"
      : format(data, "d 'de' MMMM", { locale: ptBR });

  return (
    <div className="my-3 flex justify-center">
      <span
        data-separador
        suppressHydrationWarning
        className="rounded-pill bg-surface-raised px-2.5 py-1 text-meta font-medium text-ink-secondary shadow-card"
      >
        {rotulo}
      </span>
    </div>
  );
}

export function MessageBubble({
  message,
  conversationId,
  quoted,
  agrupada,
  ultimaDoGrupo,
  onReply,
  onChanged,
}: {
  message: Message;
  conversationId: number;
  quoted: Message | null;
  /** Continua o bloco de quem falou antes: cola na de cima e cala o autor. */
  agrupada: boolean;
  /** Fecha o bloco: só ela carrega horário e tique. */
  ultimaDoGrupo: boolean;
  onReply: () => void;
  onChanged: () => void;
}) {
  const outbound = message.direction === "outbound";
  /**
   * O menu vive aqui, e não dentro de MessageActions, porque o toque longo
   * acontece na BOLHA. No celular não existe hover: sem este caminho, responder
   * e reagir simplesmente não existiam no aparelho onde se atende.
   */
  const [menuAberto, setMenuAberto] = useState(false);
  const [menuParaCima, setMenuParaCima] = useState(false);
  const [menuADireita, setMenuADireita] = useState(false);
  const toqueLongo = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ultimaUrlRecuperada = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (toqueLongo.current) clearTimeout(toqueLongo.current);
    };
  }, []);

  /**
   * A direção é decidida na hora de abrir, com a posição real na tela.
   *
   * Nos dois eixos, e por medição, porque no celular os dois erram: para baixo
   * o menu cai atrás do compositor (e as mensagens que mais se responde são
   * justamente as últimas), e para a direita ele sai da tela quando a bolha é
   * curta e empurra o botão para perto da borda.
   */
  function abrirMenu(valor: boolean, ancora?: HTMLElement | null) {
    if (valor) {
      const caixa = ancora?.getBoundingClientRect();
      setMenuParaCima(caixa ? window.innerHeight - caixa.bottom < ALTURA_DO_MENU : false);
      setMenuADireita(caixa ? window.innerWidth - caixa.left < LARGURA_DO_MENU : false);
    }
    setMenuAberto(valor);
  }

  function iniciarToque(evento: React.TouchEvent<HTMLElement>) {
    // Sem id no provedor o MessageActions não renderiza nada. Armar o toque
    // longo assim mesmo trocava o menu do sistema (copiar, selecionar) por
    // NADA: `menuAberto` virava true, o `onContextMenu` passava a barrar o
    // menu nativo e nenhum menu nosso aparecia no lugar.
    if (!message.externalId) return;
    if (toqueLongo.current) clearTimeout(toqueLongo.current);
    const alvo = evento.currentTarget;
    toqueLongo.current = setTimeout(() => abrirMenu(true, alvo), 450);
  }

  function cancelarToque() {
    if (toqueLongo.current) clearTimeout(toqueLongo.current);
    toqueLongo.current = null;
  }

  const espacoAcima = agrupada ? "mt-0.5" : "mt-2.5";

  if (message.sender === "system") {
    return (
      <p className="mt-2.5 self-center rounded-control bg-surface-sunken px-2.5 py-1 text-center text-caption text-ink-secondary">
        {message.body}
      </p>
    );
  }

  if (message.deleted) {
    return (
      <div className={cn("flex", espacoAcima, outbound ? "justify-end" : "justify-start")}>
        <div className="max-w-[85%] rounded-card border border-dashed border-line px-3 py-2 text-body text-ink-tertiary italic">
          Mensagem apagada
        </div>
      </div>
    );
  }

  const MediaIcon = MEDIA_ICON[message.messageType];
  const rotuloDaMidia = MEDIA_LABEL[message.messageType];
  const corpo = textoVisivel(message.body);
  const ehArquivo =
    message.messageType !== "text" && !["image", "audio", "ptt", "video"].includes(message.messageType);
  const podeBaixarArquivo = ["document", "sticker"].includes(message.messageType);

  function recuperarPreviaExpirada() {
    if (!message.mediaUrl || ultimaUrlRecuperada.current === message.mediaUrl) return;
    ultimaUrlRecuperada.current = message.mediaUrl;
    void loadMediaAction({ conversationId, messageId: message.id }).then((result) => {
      if (result.ok && result.url && result.url !== message.mediaUrl) onChanged();
    });
  }
  // Primeiro nome, como nos selos da lista: "Mariana Albuquerque" esticava a
  // bolha de um "teste" até a largura do nome, e quem atendeu se identifica
  // pelo primeiro nome em qualquer clínica.
  const autor = message.sender === "ai" ? "IA" : (message.senderName?.split(" ")[0] ?? null);
  const mostrarAutor = !agrupada && Boolean(autor);

  return (
    <div className={cn("group flex", espacoAcima, outbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "flex min-w-0 max-w-[85%] items-center gap-0.5",
          outbound ? "flex-row" : "flex-row-reverse",
        )}
      >
        <MessageActions
          conversationId={conversationId}
          message={message}
          aberto={menuAberto}
          paraCima={menuParaCima}
          aDireita={menuADireita}
          onAbertoChange={abrirMenu}
          onReply={onReply}
          onChanged={onChanged}
        />

        <div className="flex min-w-0 flex-col">
          <div
            data-bolha={outbound ? "outbound" : "inbound"}
            onTouchStart={iniciarToque}
            onTouchEnd={cancelarToque}
            onTouchMove={cancelarToque}
            onTouchCancel={cancelarToque}
            onContextMenu={(evento) => {
              // Só barra o menu do sistema quando o nosso já está de pé: fora
              // disso, "copiar" continua sendo do navegador.
              if (menuAberto) evento.preventDefault();
            }}
            className={cn(
              // `flow-root` é o que faz a bolha CRESCER junto com o rodapé
              // flutuante do horário; sem isso ele escapa e vaza da bolha.
              // `break-words` não basta: um token colado sem espaço só quebra
              // com `anywhere`, e sem isso ele atravessa a coluna vizinha.
              "flow-root rounded-card px-3 py-2 text-body text-ink shadow-card [overflow-wrap:anywhere]",
              // Sobre o canvas #f4f7fc, saída em #eaf1fe e entrada em branco se
              // separam de relance. Antes eram dois quase-brancos e só o
              // alinhamento dizia quem tinha falado.
              outbound ? "bg-accent-soft" : "bg-surface-raised",
              // Canto interno do bloco fica reto: é o que costura as bolhas
              // seguidas do mesmo autor numa fala só.
              agrupada && (outbound ? "rounded-tr-control" : "rounded-tl-control"),
              !ultimaDoGrupo && (outbound ? "rounded-br-control" : "rounded-bl-control"),
            )}
          >
            {mostrarAutor ? (
              /* O acento fica só para a IA: numa conversa em que a clínica
                 responde o tempo todo, o nome da atendente em azul competia com
                 o texto e ainda parecia link. Quem atendeu é contexto; quem
                 respondeu sem ser gente é aviso. */
              <span
                className={cn(
                  "mb-0.5 flex items-center gap-1 text-meta font-medium",
                  message.sender === "ai" ? "text-accent" : "text-ink-secondary",
                )}
              >
                {message.sender === "ai" ? <Bot className="size-3 shrink-0" aria-hidden /> : null}
                <span className="truncate">{autor}</span>
              </span>
            ) : null}

            {quoted ? (
              <span className="mb-1.5 block rounded-control border-l-2 border-accent bg-surface-sunken/70 py-1 pr-1.5 pl-2 text-caption text-ink-secondary [overflow-wrap:anywhere]">
                <span className="block font-medium text-accent">
                  {quoted.direction === "outbound" ? "Você" : "Cliente"}
                </span>
                <span className="block truncate">
                  {(quoted.audioTranscription || textoVisivel(quoted.body) || MEDIA_LABEL[quoted.messageType] || "Mídia").slice(0, 90)}
                </span>
              </span>
            ) : null}

            {message.messageType === "image" ? (
              message.mediaUrl ? (
                <a href={message.mediaUrl} target="_blank" rel="noreferrer" className="mb-1.5 block">
                  <img
                    src={message.mediaUrl}
                    alt={corpo || "Imagem recebida"}
                    className="max-h-[280px] w-auto rounded-control"
                    onError={recuperarPreviaExpirada}
                  />
                </a>
              ) : (
                <MediaPlaceholder
                  conversationId={conversationId}
                  messageId={message.id}
                  icon={ImageIcon}
                  label="Foto"
                  onLoaded={onChanged}
                />
              )
            ) : null}

            {message.messageType === "audio" || message.messageType === "ptt" ? (
              message.mediaUrl ? (
                // Player nativo: toca sem sair da conversa e sem baixar nada.
                <audio controls src={message.mediaUrl} className="mb-1.5 block h-9 w-[240px] max-w-full" onError={recuperarPreviaExpirada} />
              ) : (
                <MediaPlaceholder
                  conversationId={conversationId}
                  messageId={message.id}
                  icon={Mic}
                  label="Mensagem de voz"
                  onLoaded={onChanged}
                />
              )
            ) : null}

            {/*
              Vídeo tem o mesmo destino da foto e do áudio quando chega sem
              link, e por muito tempo não teve: `ehArquivo` exclui `video`, e o
              ramo abaixo exigia `mediaUrl`. O resultado era uma bolha que não
              dizia ser vídeo, não oferecia carregar — e, sem legenda, ficava
              literalmente vazia. É a mesma falha da localização, no outro tipo.
            */}
            {message.messageType === "video" ? (
              message.mediaUrl ? (
                <video controls src={message.mediaUrl} className="mb-1.5 block max-h-[280px] w-auto rounded-control" onError={recuperarPreviaExpirada} />
              ) : (
                <MediaPlaceholder
                  conversationId={conversationId}
                  messageId={message.id}
                  icon={Video}
                  label="Vídeo"
                  onLoaded={onChanged}
                />
              )
            ) : null}

            {/*
              Sem `MediaIcon` esta linha inteira sumia — e com o corpo sendo o
              marcador interno (`[localização]`), que também é escondido, a bolha
              ficava VAZIA: 16px de nada onde havia uma localização recebida.
              O tipo desconhecido agora cai no genérico em vez de desaparecer.
            */}
            {ehArquivo ? (
              <span className="mb-1 flex items-center gap-1.5 text-caption text-ink-secondary">
                {MediaIcon ? (
                  <MediaIcon className="size-3.5 shrink-0" aria-hidden />
                ) : (
                  <FileText className="size-3.5 shrink-0" aria-hidden />
                )}
                <span className="truncate">{message.mediaFileName || rotuloDaMidia || "Arquivo"}</span>
                {podeBaixarArquivo ? (
                  <OpenMediaButton conversationId={conversationId} messageId={message.id} />
                ) : message.mediaUrl ? (
                  <a href={message.mediaUrl} target="_blank" rel="noreferrer" className="text-accent">abrir</a>
                ) : null}
              </span>
            ) : null}

            {/* Áudio transcrito aparece como texto: é o que a atendente precisa
                ler para responder sem ouvir tudo de novo. */}
            {message.audioTranscription ? (
              <span className="mt-1 block rounded-control bg-surface-sunken/70 px-2.5 py-2">
                <span className="mb-0.5 flex items-center gap-1 text-meta font-medium text-accent">
                  <Bot className="size-3" aria-hidden />
                  Transcrição por IA
                </span>
                <span className="block whitespace-pre-wrap text-caption text-ink-secondary">
                  {message.audioTranscription}
                </span>
              </span>
            ) : corpo ? (
              <span className="whitespace-pre-wrap">{corpo}</span>
            ) : null}

            {/*
              Horário e tique DENTRO de cada bolha, como no WhatsApp. Isso
              também evita que áudios agrupados escondam sua confirmação e conserta um
              desalinhamento real: como irmão do bloco que o menu de ações
              empurrava, o horário flutuava dezenas de pixels fora da bolha.

              É `float` de propósito: assim ele entra no fluxo do texto e a
              última linha se encurta em vez de passar por baixo dele.
            */}
            <span
              data-meta
              className={cn(
                "float-right mt-1 ml-2 flex items-center gap-1 text-meta whitespace-nowrap",
                message.status === "failed" && outbound ? "text-danger" : "text-ink-secondary",
              )}
            >
              <span suppressHydrationWarning className="tabular">
                {format(new Date(message.createdAt), "HH:mm", { locale: ptBR })}
              </span>
              {outbound ? <DeliveryTick status={message.status} /> : null}
            </span>
          </div>

          {message.reactions && message.reactions.length > 0 ? (
            <span
              className={cn(
                "-mt-2 flex w-fit gap-0.5 rounded-full border border-line bg-surface-raised px-1.5 py-0.5 text-[13px] leading-none shadow-sm",
                outbound ? "self-end" : "self-start",
              )}
            >
              {message.reactions.map((r, i) => (
                <span key={`${r.emoji}-${i}`}>{r.emoji}</span>
              ))}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Mídia sem link.
 *
 * Acontece nos dois sentidos: o que enviamos vai em base64 e não deixa URL, e o
 * que chega nem sempre traz o link no webhook. A primeira tentativa é
 * automática, como no WhatsApp Web; se o provedor não entregar, fica um botão
 * de nova tentativa no lugar de uma bolha vazia.
 */
function MediaPlaceholder({
  conversationId,
  messageId,
  icon: Icon,
  label,
  onLoaded,
}: {
  conversationId: number;
  messageId: number;
  icon: typeof ImageIcon;
  label: string;
  onLoaded: () => void;
}) {
  const [carregando, startCarregando] = useTransition();
  const [falhou, setFalhou] = useState(false);
  const tentou = useRef(false);

  function carregar(mostrarErro: boolean) {
    startCarregando(async () => {
      const result = await loadMediaAction({ conversationId, messageId });
      if (!result.ok || !result.url) {
        setFalhou(true);
        if (mostrarErro) toast.error(result.ok ? "A mídia não está mais disponível no WhatsApp." : result.error);
        return;
      }
      setFalhou(false);
      onLoaded();
    });
  }

  useEffect(() => {
    if (tentou.current) return;
    tentou.current = true;
    carregar(false);
    // A mensagem identifica a mídia. `onLoaded` pode mudar a cada render do
    // inbox e não deve disparar downloads repetidos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, messageId]);

  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-caption text-ink-secondary">
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {label}
      {carregando ? <span>carregando…</span> : falhou ? (
        <button
          type="button"
          className="text-accent disabled:opacity-60"
          onClick={() => carregar(true)}
        >
          tentar novamente
        </button>
      ) : null}
    </span>
  );
}

/** Renova o link temporário antes de abrir; a uazapi expira esses links. */
function OpenMediaButton({ conversationId, messageId }: { conversationId: number; messageId: number }) {
  const [loading, startLoading] = useTransition();

  function abrir() {
    const tab = window.open("about:blank", "_blank");
    startLoading(async () => {
      const result = await loadMediaAction({ conversationId, messageId });
      if (!result.ok || !result.url) {
        tab?.close();
        toast.error(result.ok ? "Este arquivo não está mais disponível no WhatsApp." : result.error);
        return;
      }
      if (tab) tab.location.href = result.url;
      else window.location.assign(result.url);
    });
  }

  return (
    <button type="button" disabled={loading} onClick={abrir} className="text-accent disabled:opacity-60">
      {loading ? "carregando…" : "abrir"}
    </button>
  );
}

/** Estado de entrega no padrão que todo mundo já conhece do WhatsApp. */
export function DeliveryTick({ status }: { status: string }) {
  if (status === "failed") return <TriangleAlert className="size-3 shrink-0 text-danger" aria-label="falhou" />;
  if (status === "read") return <CheckCheck className="size-3 shrink-0 text-info" aria-label="lida" />;
  if (status === "delivered") return <CheckCheck className="size-3 shrink-0" aria-label="entregue" />;
  if (status === "pending") return <Clock className="size-3 shrink-0" aria-label="enviando" />;
  return <Check className="size-3 shrink-0" aria-label="enviada" />;
}
