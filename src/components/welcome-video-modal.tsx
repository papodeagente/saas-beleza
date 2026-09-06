"use client";

import { Play, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { markWelcomeVideoSeenAction } from "@/app/(app)/welcome-video-actions";

/**
 * O vídeo de boas-vindas, na primeira entrada depois do cadastro.
 *
 * Sem autoplay: o vídeo é narrado, e autoplay com som é bloqueado pelo
 * navegador — autoplay mudo de um vídeo que existe pra ser OUVIDO só
 * ensinaria a clonar o dedo no play, não o produto. Em troca, um cartaz
 * grande com play: o clique que inicia o vídeo é o mesmo gesto que libera o
 * áudio, então o som sempre funciona de primeira.
 *
 * `seen` decide se o servidor já viu esse vídeo alguma vez (prop vinda do
 * layout); o componente nasce montado sempre, e é ele quem decide sumir —
 * assim fechar não pede um novo carregamento de página nem um piscar de
 * conteúdo atrás do vídeo.
 */
export function WelcomeVideoModal({ seen }: { seen: boolean }) {
  const [open, setOpen] = useState(!seen);
  const [playing, setPlaying] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (open) closeBtnRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function close() {
    setOpen(false);
    markWelcomeVideoSeenAction().catch(() => {
      // Falhar em marcar "visto" não pode travar quem já fechou o vídeo — na
      // pior das hipóteses ele aparece de novo na próxima entrada.
    });
  }

  function play() {
    setPlaying(true);
    videoRef.current?.play().catch(() => {});
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Vídeo de boas-vindas ao Agenda de Unha"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-night/90 p-4 backdrop-blur-sm animate-overlay-in"
    >
      <div className="relative w-full max-w-[880px]">
        <button
          ref={closeBtnRef}
          type="button"
          onClick={close}
          aria-label="Fechar vídeo"
          className="absolute -top-12 right-0 flex items-center gap-1.5 rounded-pill px-3 py-2 text-label text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        >
          {playing ? "Fechar" : "Pular"}
          <X className="size-4" />
        </button>

        <div className="overflow-hidden rounded-overlay bg-black shadow-2xl">
          <div className="relative aspect-video w-full">
            <video
              ref={videoRef}
              src="/onboarding/bem-vindo.mp4"
              controls={playing}
              playsInline
              onEnded={close}
              className="size-full"
            />
            {!playing ? (
              <button
                type="button"
                onClick={play}
                className="group absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-accent/30 to-night text-white"
              >
                <span className="flex size-20 items-center justify-center rounded-pill bg-white text-accent shadow-lift transition-transform group-hover:scale-105">
                  <Play className="size-9 translate-x-0.5" fill="currentColor" />
                </span>
                <span className="max-w-[46ch] px-6 text-center text-lede font-semibold">
                  Antes de começar, veja como o Agenda de Unha funciona
                </span>
                <span className="text-caption text-white/70">5 minutos · com áudio</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
