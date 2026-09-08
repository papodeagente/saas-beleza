"use client";

import { useEffect, useRef } from "react";

/**
 * O vídeo de demonstração do hero — ~16s, sem som, em loop.
 *
 * `autoPlay` fica no HTML (funciona sem JS, e o `muted` já satisfaz a
 * política de autoplay do navegador). O JS aqui cuida só do que HTML puro
 * não resolve: quem pediu menos movimento no sistema não deveria receber
 * 16 segundos de vídeo tocando sozinho — bem acima dos ~5s que a WCAG usa
 * como referência para conteúdo que precisa de controle de pausa. Pausado
 * no primeiro frame (a tela Hoje), ainda comunica o produto parado.
 */
export function HeroDemoVideo(props: React.VideoHTMLAttributes<HTMLVideoElement>) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      video.pause();
      video.currentTime = 0;
    }
  }, []);

  return <video ref={ref} {...props} />;
}
