"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Entrada por rolagem, uma vez só.
 *
 * "Uma vez só" é a regra inteira: animação que refaz quando o usuário volta o
 * scroll é o tique mais reconhecível de página feita com template. O observador
 * se desconecta no primeiro cruzamento e nunca mais roda.
 *
 * Quem pede menos movimento não passa por aqui: o estado escondido vive numa
 * regra de CSS que `prefers-reduced-motion` anula (ver globals.css). Resolver
 * isso no CSS e não com um `matchMedia` no efeito evita um segundo render em
 * toda a página e mantém o conteúdo visível mesmo se o JavaScript falhar.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "li" | "section" | "article";
}) {
  const ref = useRef<HTMLElement>(null);
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    const alvo = ref.current;
    if (!alvo) return;

    const obs = new IntersectionObserver(
      ([entrada]) => {
        if (!entrada.isIntersecting) return;
        setVisivel(true);
        obs.disconnect();
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" },
    );
    obs.observe(alvo);
    return () => obs.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      data-reveal={visivel ? "visivel" : "escondido"}
      className={cn("transition-[opacity,transform] duration-700 ease-out-quint", className)}
      // O atraso escalona a entrada de uma grade inteira (i * 80ms) sem que
      // cada item precise do seu próprio observador.
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
