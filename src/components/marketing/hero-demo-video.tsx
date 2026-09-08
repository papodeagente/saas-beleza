"use client";

import { useEffect, useRef } from "react";

/**
 * O vídeo de demonstração do hero — ~16s, sem som, em loop.
 *
 * Dupla garantia de que ele começa sozinho, sem nenhum clique: o atributo
 * `autoPlay` no HTML (funciona sem JS, e o `muted` já satisfaz a política de
 * autoplay de todo navegador) MAIS uma chamada explícita a `.play()` aqui,
 * porque autoplay por atributo pode ser recusado silenciosamente em
 * combinações específicas de navegador/extensão/política do Windows — a
 * chamada por JS é o reforço para esses casos, e o `.catch()` evita erro no
 * console quando o navegador realmente bloqueia (aí ele fica parado na
 * capa, que já é a tela Hoje de verdade, nunca um quadro em branco).
 *
 * Quem pediu menos movimento no sistema não deveria receber 16 segundos de
 * vídeo tocando sozinho — bem acima dos ~5s que a WCAG usa como referência
 * para conteúdo que precisa de controle de pausa. Pausado na capa (a tela
 * Hoje), ainda comunica o produto parado.
 */
export function HeroDemoVideo(props: React.VideoHTMLAttributes<HTMLVideoElement>) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      video.pause();
      video.currentTime = 0;
      return;
    }
    video.play().catch(() => {
      // Bloqueado pelo navegador — fica na capa (poster), sem erro no console.
    });
  }, []);

  return <video ref={ref} {...props} />;
}
