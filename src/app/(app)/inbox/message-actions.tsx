"use client";

import { CornerUpLeft, FileText, MoreVertical, Smile, Trash2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { deleteMessageAction, reactAction, transcribeAction } from "./actions";

/**
 * Ações sobre uma mensagem: reagir, responder, transcrever e apagar.
 *
 * Onde existe ponteiro, ficam escondidas até ele chegar perto — numa conversa
 * longa, um punhado de botões por bolha compete com o texto, que é o que a
 * atendente precisa ler.
 *
 * Onde NÃO existe ponteiro, hover nunca acontece: `opacity-0` deixava responder
 * e reagir funcionalmente inexistentes justamente no celular, que é o aparelho
 * onde se atende. Por isso a visibilidade parcial permanente no toque, o alvo
 * maior e o toque longo na bolha (quem abre o menu por ali é o MessageBubble,
 * dono deste estado).
 */

/** As mesmas seis do WhatsApp: cobrem quase toda reação real. */
const REACOES = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

type MessageLike = {
  id: number;
  direction: "inbound" | "outbound";
  messageType: string;
  externalId: string | null;
  audioTranscription: string | null;
  reactions: Array<{ emoji: string; fromMe: boolean }> | null;
};

export function MessageActions({
  conversationId,
  message,
  aberto,
  paraCima,
  aDireita,
  onAbertoChange,
  onReply,
  onChanged,
}: {
  conversationId: number;
  message: MessageLike;
  /** Controlado de fora: o toque longo na bolha abre este mesmo menu. */
  aberto: boolean;
  /** Sem espaço abaixo, o menu sobe — senão some atrás do compositor. */
  paraCima: boolean;
  /** Sem espaço à direita, o menu alinha pela direita — senão sai da tela. */
  aDireita: boolean;
  onAbertoChange: (aberto: boolean, ancora?: HTMLElement | null) => void;
  onReply: () => void;
  onChanged: () => void;
}) {
  const [busy, startBusy] = useTransition();

  function setAberto(valor: boolean, ancora?: HTMLElement | null) {
    onAbertoChange(valor, ancora);
  }

  // Sem id no provedor não há o que reagir nem apagar lá fora.
  if (!message.externalId) return null;

  const minhaReacao = message.reactions?.find((r) => r.fromMe)?.emoji ?? null;
  const podeApagar = message.direction === "outbound";
  const podeTranscrever = message.messageType === "audio" && !message.audioTranscription;

  function reagir(emoji: string) {
    // Tocar de novo no mesmo emoji desfaz, como no WhatsApp.
    const valor = minhaReacao === emoji ? "" : emoji;
    setAberto(false);
    startBusy(async () => {
      const result = await reactAction({ conversationId, messageId: message.id, emoji: valor });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onChanged();
    });
  }

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center transition-opacity focus-within:opacity-100",
        // No toque o menu fica visível de leve, sempre. O par hover só entra
        // onde existe ponteiro — em tela sensível ao toque `group-hover` gruda
        // depois do primeiro toque e nunca mais solta.
        "opacity-55",
        "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100",
        aberto && "opacity-100",
      )}
    >
      <button
        type="button"
        aria-label="Ações da mensagem"
        aria-expanded={aberto}
        onClick={(evento) => setAberto(!aberto, evento.currentTarget)}
        className={cn(
          // 36px de alvo no toque; onde há ponteiro, 28px basta e polui menos.
          "flex size-9 items-center justify-center rounded-full text-ink-tertiary hover:bg-surface-sunken hover:text-ink [@media(hover:hover)]:size-7",
          aberto && "bg-surface-sunken text-ink",
        )}
      >
        <MoreVertical className="size-4" aria-hidden />
      </button>

      {aberto ? (
        <>
          {/* Clique fora fecha sem precisar acertar o botão de novo. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setAberto(false)}
          />
          <div
            className={cn(
              // A largura é limitada para o menu CABER: com seis reações de 36px numa
              // linha ele passava de 240px e, ancorado no meio de uma tela de
              // 390, transbordava por qualquer um dos dois lados. Abaixo do teto
              // as reações quebram em duas linhas, que é o que se pode ceder.
              "absolute z-20 w-max max-w-[min(200px,calc(100vw-24px))] rounded-card border border-line bg-surface-raised p-1.5 shadow-lg",
              // Medido, não adivinhado: o botão troca de lado conforme quem
              // falou E anda com o tamanho da bolha, então nenhuma âncora fixa
              // sobrevive aos dois casos numa tela de 390px.
              aDireita ? "right-0" : "left-0",
              // E abre para cima nas últimas mensagens, que são justamente as
              // que se responde: para baixo ele ficava atrás do compositor.
              paraCima ? "bottom-full mb-1" : "top-full mt-1",
            )}
          >
            <div className="mb-1 flex flex-wrap gap-0.5 border-b border-line pb-1.5">
              {REACOES.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  disabled={busy}
                  onClick={() => reagir(emoji)}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-control text-[20px] leading-none hover:bg-surface-sunken [@media(hover:hover)]:size-7 [@media(hover:hover)]:text-[18px]",
                    minhaReacao === emoji && "bg-accent-soft",
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>

            <MenuItem
              icon={CornerUpLeft}
              label="Responder"
              onClick={() => {
                setAberto(false);
                onReply();
              }}
            />

            {podeTranscrever ? (
              <MenuItem
                icon={FileText}
                label="Transcrever áudio"
                disabled={busy}
                onClick={() => {
                  setAberto(false);
                  startBusy(async () => {
                    const result = await transcribeAction({ conversationId, messageId: message.id });
                    if (!result.ok) {
                      toast.error(result.error);
                      return;
                    }
                    if (!result.text) {
                      toast.error("Não veio texto na transcrição.");
                      return;
                    }
                    toast.success("Áudio transcrito");
                    onChanged();
                  });
                }}
              />
            ) : null}

            {podeApagar ? (
              <MenuItem
                icon={Trash2}
                label="Apagar para todos"
                danger
                disabled={busy}
                onClick={() => {
                  setAberto(false);
                  if (!confirm("Apagar esta mensagem para todos? Não dá para desfazer.")) return;
                  startBusy(async () => {
                    const result = await deleteMessageAction({ conversationId, messageId: message.id });
                    if (!result.ok) {
                      toast.error(result.error);
                      return;
                    }
                    toast.success("Mensagem apagada");
                    onChanged();
                  });
                }}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
  disabled,
}: {
  icon: typeof Smile;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 rounded-control px-2.5 py-2.5 text-left text-label transition-colors hover:bg-surface-sunken disabled:opacity-50 [@media(hover:hover)]:py-1.5",
        danger ? "text-danger" : "text-ink",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {label}
    </button>
  );
}
