"use client";

import { User } from "lucide-react";
import { useState } from "react";
import { identityTint } from "@/lib/color";
import { cn } from "@/lib/utils";

/**
 * Iniciais só de PALAVRA, nunca do que estiver na coluna `name`.
 *
 * Contato que chega pelo WhatsApp antes de ser identificado tem o telefone no
 * lugar do nome, e a versão anterior devolvia dele o que fosse: "(9" para
 * "(84) 99999-0000", "55" para "5584999990000". Dois caracteres de pontuação
 * dentro de um círculo não são iniciais de ninguém — são lixo com cara de dado.
 *
 * Devolve null quando não sobra letra, e aí o avatar mostra o ícone de pessoa,
 * que é a informação honesta: "esta pessoa ainda não tem nome".
 */
export function initials(name: string): string | null {
  const words = name
    .trim()
    .split(/\s+/)
    // Uma palavra só conta se COMEÇAR por letra: "(84)" e "99999-0000" saem,
    // "D'Ávila" e "Ângela" ficam.
    .filter((word) => /^\p{L}/u.test(word));
  if (words.length === 0) return null;
  if (words.length === 1) {
    const single = [...words[0]].filter((c) => /\p{L}/u.test(c));
    return single.slice(0, 2).join("").toUpperCase();
  }
  return (words[0][0] + words.at(-1)![0]).toUpperCase();
}

const SIZES = {
  sm: "size-6 text-meta",
  md: "size-8 text-meta",
  lg: "size-10 text-label",
} as const;

export function Avatar({
  name,
  size = "md",
  color,
  src,
  className,
}: {
  name: string;
  size?: keyof typeof SIZES;
  /** Cor de identidade (profissional). Pode ser qualquer valor cadastrado. */
  color?: string;
  /** Foto de perfil. Falhando o carregamento, as iniciais reaparecem. */
  src?: string | null;
  className?: string;
}) {
  const [falhou, setFalhou] = useState(false);
  const mostrarFoto = Boolean(src) && !falhou;
  const iniciais = mostrarFoto ? null : initials(name);

  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-medium",
        SIZES[size],
        !color && !mostrarFoto && "bg-accent-soft text-accent",
        mostrarFoto && "bg-surface-sunken",
        className,
      )}
      style={
        color && !mostrarFoto
          ? (() => {
              // A cor cadastrada é livre e pode não ter contraste sobre o próprio
              // tom claro (a âmbar media 4,18:1). identityTint escurece só o
              // necessário para cruzar 4.5:1, preservando a identidade.
              const tint = identityTint(color);
              return { backgroundColor: tint.background, color: tint.foreground };
            })()
          : undefined
      }
    >
      {mostrarFoto ? (
        /* A foto pode ter sumido do banco entre a renderização e o pedido.
           Cair nas iniciais é melhor que um quadrado vazio, então o erro é
           tratado em vez de ignorado.

           A miniatura tem 2,6 KB e é servida do nosso próprio domínio;
           next/image aqui exigiria o sharp em runtime, que não é rastreado
           para o bundle standalone do Docker. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src ?? ""}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFalhou(true)}
          className="size-full object-cover"
        />
      ) : iniciais ? (
        iniciais
      ) : (
        <User className="size-[55%]" strokeWidth={2} aria-hidden />
      )}
    </span>
  );
}
