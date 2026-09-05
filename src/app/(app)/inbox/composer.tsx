"use client";

import { FileText, Mic, MicOff, Paperclip, Send, Smile, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { sendMediaAction } from "./actions";

/**
 * Compositor do inbox.
 *
 * Reúne o que uma conversa de WhatsApp exige e um campo de texto puro não dá:
 * emoji, anexo, mensagem de voz e resposta a uma mensagem específica. A
 * gravação usa o microfone do próprio navegador e vira mensagem de voz de
 * verdade (o tipo `ptt`), não um arquivo de áudio anexado — para quem recebe,
 * a diferença é entre tocar na hora e ter que baixar.
 */

export type ReplyTarget = { messageId: number; externalId: string | null; preview: string; fromMe: boolean } | null;

const EMOJI_GROUPS: Array<{ label: string; emojis: string[] }> = [
  {
    label: "Frequentes",
    emojis: ["😀", "😊", "😍", "🥰", "😘", "👍", "🙏", "❤️", "🎉", "✨", "🔥", "💜", "😂", "🤝", "👏", "💅"],
  },
  {
    label: "Rostos",
    emojis: ["😃", "😄", "😁", "😉", "🙂", "🤗", "🤩", "😎", "🥳", "😌", "😔", "😢", "😭", "😅", "😬", "🙄", "😴", "🤔", "😇", "🥺"],
  },
  {
    label: "Gestos",
    emojis: ["👋", "🤙", "✌️", "🤞", "💪", "🙌", "👌", "🫶", "🤲", "👇", "👉", "☝️"],
  },
  {
    label: "Beleza",
    emojis: ["💇", "💇‍♀️", "💆", "💆‍♀️", "💅", "💄", "🧴", "🧖‍♀️", "✂️", "🪒", "🧼", "🌸", "🌺", "🪞", "👑", "💎"],
  },
  {
    label: "Agenda",
    emojis: ["📅", "🗓️", "⏰", "⌛", "✅", "❌", "📍", "🏠", "🚗", "💰", "💳", "🧾", "📞", "💬", "📸", "⭐"],
  },
];

function lerArquivo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Não consegui ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

type MidiaPendente = {
  dataUrl: string;
  previewUrl: string;
  kind: "image" | "video" | "document" | "audio" | "ptt";
  fileName: string;
  mimeType: string;
  size: number;
};

function tipoDoArquivo(file: File): MidiaPendente["kind"] {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "document";
}

function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export function Composer({
  conversationId,
  disabled,
  reply,
  onClearReply,
  onEnviar,
  onSent,
}: {
  conversationId: number;
  disabled?: boolean;
  reply: ReplyTarget;
  onClearReply: () => void;
  /**
   * Registra o texto na conversa ANTES de falar com o servidor e devolve se
   * conseguiu. O envio em si é do inbox: é lá que a bolha otimista existe e é
   * ela que passa a guardar o que foi digitado.
   */
  onEnviar: (entrada: { body: string; replyToExternalId?: string }) => boolean;
  onSent: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [emojiAberto, setEmojiAberto] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [midia, setMidia] = useState<MidiaPendente | null>(null);
  /**
   * O microfone só existe em contexto seguro (HTTPS ou localhost). Servido por
   * HTTP puro, `navigator.mediaDevices` sequer é definido — e um botão que
   * falha sempre é pior do que um botão ausente com a explicação do porquê.
   *
   * É uma capacidade do navegador, não um estado que muda: lida direto na
   * renderização do cliente, sem efeito e sem re-render em cascata.
   */
  const podeGravar = useSyncExternalStore(
    () => () => {},
    () => Boolean(navigator.mediaDevices?.getUserMedia),
    // No servidor assume que dá, para o botão não piscar de desabilitado a
    // habilitado na hidratação.
    () => true,
  );
  const [segundos, setSegundos] = useState(0);
  const [enviando, startEnviando] = useTransition();
  const inputArquivo = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const pedacos = useRef<BlobPart[]>([]);
  const ultimaPresenca = useRef(0);

  useEffect(() => {
    if (!gravando) return;
    const timer = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [gravando]);

  // Encerra a captura se o componente sair da tela no meio da gravação: sem
  // isso o microfone fica aberto.
  useEffect(() => {
    return () => {
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    return () => {
      if (midia?.previewUrl) URL.revokeObjectURL(midia.previewUrl);
    };
  }, [midia]);

  /**
   * Avisa a cliente que estamos escrevendo.
   *
   * Vai por rota própria, e não por server action, porque server action sai
   * numa fila única: um aviso a cada três segundos de digitação punha meio
   * segundo de rede na frente do próximo toque da atendente. `keepalive`
   * garante que o último aviso ainda saia se a tela mudar no mesmo instante.
   */
  function avisarPresenca(presence: "composing" | "recording") {
    void fetch("/api/inbox/presenca", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId, presence }),
      keepalive: true,
    }).catch(() => undefined);
  }

  function avisarDigitando() {
    const agora = Date.now();
    // Um aviso a cada três segundos basta para manter o "digitando" aceso.
    if (agora - ultimaPresenca.current < 3000) return;
    ultimaPresenca.current = agora;
    avisarPresenca("composing");
  }

  /**
   * A caixa só é esvaziada depois que o texto está guardado em outro lugar.
   *
   * Antes, `setDraft("")` rodava antes do `await` e a restauração só existia no
   * ramo `!result.ok`: quando a chamada REJEITAVA — rede caindo, 500 do
   * servidor — o texto sumia para sempre e ninguém era avisado. Agora quem
   * segura a frase é a bolha otimista, que ainda oferece "tentar de novo".
   */
  function enviarTexto() {
    const body = draft.trim();
    if (!body) return;
    try {
      const registrou = onEnviar({ body, replyToExternalId: reply?.externalId ?? undefined });
      if (!registrou) return;
      setDraft("");
      onClearReply();
    } catch (erro) {
      console.error(erro);
      toast.error("Não foi possível enviar a mensagem. O texto continua aqui.");
    }
  }

  async function prepararArquivo(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Arquivo muito grande. O limite é 10 MB.");
      return;
    }
    let dataUrl: string;
    try {
      dataUrl = await lerArquivo(file);
    } catch {
      toast.error("Não consegui ler o arquivo. Tente de novo.");
      return;
    }
    setMidia({
      dataUrl,
      previewUrl: URL.createObjectURL(file),
      kind: tipoDoArquivo(file),
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
    });
    setEmojiAberto(false);
  }

  function descartarMidia() {
    setMidia(null);
  }

  function enviarMidia() {
    if (!midia) return;
    const selecionada = midia;
    startEnviando(async () => {
      try {
        const result = await sendMediaAction({
          conversationId,
          dataUrl: selecionada.dataUrl,
          kind: selecionada.kind,
          fileName: selecionada.fileName,
          caption: draft.trim() || undefined,
          replyToExternalId: reply?.externalId ?? undefined,
        });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        // A legenda só sai da caixa depois da confirmação: ela viaja junto com
        // o anexo e não tem bolha otimista para segurá-la.
        setDraft("");
        setMidia(null);
        onClearReply();
        onSent();
      } catch (erro) {
        console.error(erro);
        toast.error("Não foi possível enviar o anexo. A legenda continua na caixa.");
      }
    });
  }

  async function iniciarGravacao() {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Gravar áudio exige uma conexão segura (HTTPS). Configure um domínio com certificado para usar isto.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      pedacos.current = [];
      rec.ondataavailable = (event) => {
        if (event.data.size > 0) pedacos.current.push(event.data);
      };
      rec.start();
      recorder.current = rec;
      setSegundos(0);
      setGravando(true);
      avisarPresenca("recording");
    } catch {
      toast.error("Não consegui acessar o microfone. Verifique a permissão do navegador.");
    }
  }

  function pararGravacao(enviar: boolean) {
    const rec = recorder.current;
    if (!rec) return;
    rec.onstop = async () => {
      rec.stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      setGravando(false);
      if (!enviar) return;

      const blob = new Blob(pedacos.current, { type: rec.mimeType || "audio/webm" });
      if (blob.size < 1200) {
        toast.error("Gravação curta demais.");
        return;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Não consegui ler a gravação."));
        reader.readAsDataURL(blob);
      }).catch(() => null);
      if (!dataUrl) {
        toast.error("Não consegui ler a gravação. Grave de novo.");
        return;
      }

      setMidia({
        dataUrl,
        previewUrl: URL.createObjectURL(blob),
        kind: "ptt",
        fileName: "Mensagem de voz",
        mimeType: blob.type,
        size: blob.size,
      });
    };
    rec.stop();
  }

  if (disabled) {
    return (
      <p className="mx-auto max-w-[680px] text-center text-caption text-ink-secondary">
        Esta conversa não tem número de WhatsApp, então não dá para responder por aqui.
      </p>
    );
  }

  return (
    <div className="mx-auto flex max-w-[680px] flex-col gap-2">
      {reply ? (
        <div className="flex items-start gap-2 rounded-control border-l-2 border-accent bg-surface-sunken px-3 py-1.5">
          <span className="min-w-0 flex-1">
            <span className="block text-caption font-medium text-accent">
              {reply.fromMe ? "Respondendo você" : "Respondendo o cliente"}
            </span>
            <span className="block truncate text-caption text-ink-secondary">{reply.preview}</span>
          </span>
          <button type="button" onClick={onClearReply} aria-label="Cancelar resposta" className="text-ink-secondary">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}

      {midia ? (
        <div className="overflow-hidden rounded-card border border-line bg-surface-raised shadow-card">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-label text-ink">{midia.fileName}</p>
              <p className="text-caption text-ink-secondary">{tamanhoLegivel(midia.size)} · confira antes de enviar</p>
            </div>
            <button type="button" onClick={descartarMidia} aria-label="Remover anexo" className="rounded-full p-2 text-ink-secondary hover:bg-surface-sunken hover:text-ink">
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <div className="flex min-h-28 items-center justify-center bg-surface-sunken p-3">
            {midia.kind === "image" ? (
              <img src={midia.previewUrl} alt="Pré-visualização do anexo" className="max-h-[360px] max-w-full rounded-control object-contain" />
            ) : midia.kind === "video" ? (
              <video controls src={midia.previewUrl} className="max-h-[360px] max-w-full rounded-control" />
            ) : midia.kind === "audio" || midia.kind === "ptt" ? (
              <div className="flex w-full max-w-md items-center gap-3 rounded-card bg-surface-raised p-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"><Mic className="size-5" aria-hidden /></span>
                <audio controls src={midia.previewUrl} className="h-10 min-w-0 flex-1" />
              </div>
            ) : (
              <div className="flex max-w-md items-center gap-3 rounded-card bg-surface-raised p-4">
                <FileText className="size-9 shrink-0 text-accent" aria-hidden />
                <div className="min-w-0"><p className="truncate text-label text-ink">{midia.fileName}</p><p className="text-caption text-ink-secondary">Documento pronto para envio</p></div>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 px-3 py-2">
            <Button variant="ghost" size="sm" onClick={descartarMidia}>Cancelar</Button>
            <Button variant="primary" size="sm" onClick={enviarMidia} loading={enviando}><Send aria-hidden />Enviar</Button>
          </div>
        </div>
      ) : null}

      {gravando ? (
        <div className="flex items-center gap-3 rounded-control bg-danger-soft px-3 py-2">
          <span className="size-2.5 animate-pulse rounded-full bg-danger" aria-hidden />
          <span className="flex-1 text-label text-danger tabular">
            Gravando {String(Math.floor(segundos / 60)).padStart(2, "0")}:{String(segundos % 60).padStart(2, "0")}
          </span>
          <Button variant="ghost" size="sm" onClick={() => pararGravacao(false)}>
            <Trash2 aria-hidden />
            Descartar
          </Button>
          <Button variant="primary" size="sm" onClick={() => pararGravacao(true)}>
            <Send aria-hidden />
            Concluir
          </Button>
        </div>
      ) : (
        <div className="relative flex items-end gap-2">
          {emojiAberto ? (
            <div className="absolute bottom-[calc(100%+8px)] left-0 z-20 max-h-[280px] w-full max-w-[340px] overflow-y-auto rounded-card border border-line bg-surface-raised p-3 shadow-lg">
              {EMOJI_GROUPS.map((grupo) => (
                <div key={grupo.label} className="mb-2 last:mb-0">
                  <p className="mb-1 text-meta text-ink-secondary">{grupo.label}</p>
                  <div className="flex flex-wrap gap-0.5">
                    {grupo.emojis.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        className="rounded-control p-1 text-[20px] leading-none hover:bg-surface-sunken"
                        onClick={() => {
                          setDraft((atual) => atual + emoji);
                          textarea.current?.focus();
                        }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => setEmojiAberto((v) => !v)}
            aria-label="Emojis"
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-control text-ink-secondary transition-colors hover:bg-surface-sunken",
              emojiAberto && "bg-surface-sunken text-accent",
            )}
          >
            <Smile className="size-5" aria-hidden />
          </button>

          <button
            type="button"
            onClick={() => inputArquivo.current?.click()}
            aria-label="Anexar arquivo"
            className="flex size-11 shrink-0 items-center justify-center rounded-control text-ink-secondary transition-colors hover:bg-surface-sunken"
          >
            <Paperclip className="size-5" aria-hidden />
          </button>
          <input
            ref={inputArquivo}
            type="file"
            hidden
            accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void prepararArquivo(file);
            }}
          />

          <Textarea
            ref={textarea}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              avisarDigitando();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (midia) enviarMidia();
                else enviarTexto();
              }
            }}
            onFocus={() => setEmojiAberto(false)}
            rows={1}
            placeholder="Escreva sua mensagem"
            className="max-h-32 min-h-11 flex-1 resize-none"
          />

          {midia ? null : draft.trim() ? (
            <Button variant="primary" size="md" onClick={enviarTexto} loading={enviando} className="h-11 shrink-0">
              <Send aria-hidden />
              <span className="hidden sm:inline">Enviar</span>
            </Button>
          ) : podeGravar ? (
            <Button
              size="md"
              variant="secondary"
              onClick={iniciarGravacao}
              loading={enviando}
              aria-label="Gravar mensagem de voz"
              className="h-11 shrink-0"
            >
              <Mic aria-hidden />
            </Button>
          ) : (
            <Button
              size="md"
              variant="secondary"
              disabled
              title="Gravar áudio exige HTTPS. Configure um domínio com certificado."
              aria-label="Gravar mensagem de voz (indisponível sem HTTPS)"
              className="h-11 shrink-0"
            >
              <MicOff aria-hidden />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
