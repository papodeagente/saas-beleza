"use client";

import { Play } from "lucide-react";
import { useRef, useState } from "react";

/**
 * O player do vídeo explicativo — narrado, com as telas reais do sistema.
 *
 * Sem autoplay: o vídeo é narrado, e autoplay com som é bloqueado pelo
 * navegador — autoplay mudo de um vídeo que existe pra ser OUVIDO só
 * ensinaria a clicar no play, não o produto. Em troca, um cartaz grande com
 * play: o clique que inicia o vídeo é o mesmo gesto que libera o áudio, então
 * o som sempre funciona de primeira.
 *
 * Usado em dois lugares — `(auth)/criar-conta` (antes do formulário, pra
 * quem ainda não decidiu) — e reaproveitável onde mais precisar depois.
 */
export function ExplainerVideo({ onFinish }: { onFinish: () => void }) {
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  function play() {
    setPlaying(true);
    videoRef.current?.play().catch(() => {});
  }

  return (
    <div className="overflow-hidden rounded-overlay bg-black shadow-2xl">
      <div className="relative aspect-video w-full">
        <video
          ref={videoRef}
          src="/onboarding/bem-vindo.mp4"
          controls={playing}
          playsInline
          onEnded={onFinish}
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
  );
}
