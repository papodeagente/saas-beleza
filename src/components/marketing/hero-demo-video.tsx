"use client";

import { useSyncExternalStore } from "react";

/**
 * A demonstração do hero — WebP animado, não vídeo.
 *
 * Foi vídeo (`<video autoPlay muted loop>`) antes disso, e o problema não
 * era o código: navegador em modo de economia de dados (comum no Android) e
 * algumas combinações de Windows recusam autoplay de `<video>` mesmo com
 * `muted`, e mostram um botão de play por cima — política do navegador,
 * nenhum atributo de HTML muda isso. Imagem animada (WebP/GIF) não passa
 * por essa política nenhuma: todo navegador sempre anima, sempre em loop,
 * sem exceção — é a única forma de garantir "toca sozinho, sem clicar em
 * nada" de verdade, em qualquer aparelho.
 *
 * O preço é não dar pra pausar uma imagem animada por CSS de forma
 * confiável entre navegadores — por isso quem pede menos movimento no
 * sistema recebe a CAPA parada (a mesma cena, primeiro quadro) no lugar da
 * animação, decidido aqui.
 */
function subscribeReducedMotion(callback: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}
function snapshotReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
function serverSnapshotReducedMotion() {
  return false;
}

export function HeroDemoVideo({
  src,
  poster,
  alt,
  ...props
}: {
  src: string;
  poster: string;
  alt: string;
} & Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "alt">) {
  const reduced = useSyncExternalStore(subscribeReducedMotion, snapshotReducedMotion, serverSnapshotReducedMotion);

  // eslint-disable-next-line @next/next/no-img-element -- WebP animado; next/image não reproduz o loop.
  return <img src={reduced ? poster : src} alt={alt} {...props} />;
}
