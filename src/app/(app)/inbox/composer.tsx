"use client";

import { Mic, MicOff, Paperclip, Send, Smile, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { presenceAction, sendMediaAction } from "./actions";

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

function tipoDoArquivo(file: File): "image" | "video" | "document" {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return "document";
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

  function avisarDigitando() {
    const agora = Date.now();
    // Um aviso a cada três segundos basta para manter o "digitando" aceso.
    if (agora - ultimaPresenca.current < 3000) return;
    ultimaPresenca.current = agora;
    void presenceAction({ conversationId, presence: "composing" });
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

  async function enviarArquivo(file: File) {
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
    startEnviando(async () => {
      try {
        const result = await sendMediaAction({
          conversationId,
          dataUrl,
          kind: tipoDoArquivo(file),
          fileName: file.name,
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
      void presenceAction({ conversationId, presence: "recording" });
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

      startEnviando(async () => {
        try {
          const result = await sendMediaAction({
            conversationId,
            dataUrl,
            // `ptt` é a mensagem de voz que toca direto na conversa.
            kind: "ptt",
            fileName: "audio.ogg",
            replyToExternalId: reply?.externalId ?? undefined,
          });
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          onClearReply();
          onSent();
        } catch (erro) {
          // Sem isto, uma rejeição aqui vira erro não tratado dentro do
          // callback do MediaRecorder: a gravação some e nada é dito.
          console.error(erro);
          toast.error("Não foi possível enviar a mensagem de voz. Grave de novo.");
        }
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
          <Button size="sm" onClick={() => pararGravacao(true)}>
            <Send aria-hidden />
            Enviar
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
            accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void enviarArquivo(file);
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
                enviarTexto();
              }
            }}
            onFocus={() => setEmojiAberto(false)}
            rows={1}
            placeholder="Escreva sua mensagem"
            className="max-h-32 min-h-11 flex-1 resize-none"
          />

          {draft.trim() ? (
            <Button size="md" onClick={enviarTexto} loading={enviando} className="h-11 shrink-0">
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
