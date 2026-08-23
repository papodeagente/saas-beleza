"use client";

import { useState } from "react";
import { identityTint } from "@/lib/color";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts.at(-1)![0]).toUpperCase();
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
      ) : (
        initials(name)
      )}
    </span>
  );
}
