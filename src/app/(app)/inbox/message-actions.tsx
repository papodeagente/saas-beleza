"use client";

import { CornerUpLeft, FileText, MoreVertical, Smile, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { deleteMessageAction, reactAction, transcribeAction } from "./actions";

/**
 * Ações sobre uma mensagem: reagir, responder, transcrever e apagar.
 *
 * Ficam escondidas até o ponteiro chegar perto — numa conversa longa, um punhado
 * de botões por bolha compete com o texto, que é o que a atendente precisa ler.
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
  onReply,
  onChanged,
}: {
  conversationId: number;
  message: MessageLike;
  onReply: () => void;
  onChanged: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busy, startBusy] = useTransition();

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
    <div className="relative flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      <button
        type="button"
        aria-label="Ações da mensagem"
        onClick={() => setAberto((v) => !v)}
        className={cn(
          "flex size-7 items-center justify-center rounded-full text-ink-tertiary hover:bg-surface-sunken hover:text-ink",
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
          <div className="absolute top-8 left-0 z-20 w-max rounded-card border border-line bg-surface-raised p-1.5 shadow-lg">
            <div className="mb-1 flex gap-0.5 border-b border-line pb-1.5">
              {REACOES.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  disabled={busy}
                  onClick={() => reagir(emoji)}
                  className={cn(
                    "rounded-control px-1.5 py-1 text-[18px] leading-none hover:bg-surface-sunken",
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
        "flex w-full items-center gap-2 rounded-control px-2.5 py-1.5 text-left text-label transition-colors hover:bg-surface-sunken disabled:opacity-50",
        danger ? "text-danger" : "text-ink",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {label}
    </button>
  );
}
