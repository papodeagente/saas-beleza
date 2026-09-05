"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

/**
 * Código da conta, do jeito que ele é usado: lido em voz alta para o suporte.
 *
 * Fica selecionável e copiável porque as duas coisas acontecem — quem está no
 * telefone lê da tela, quem está no chat cola. O espaçamento entre caracteres
 * existe para o olho não perder o lugar no meio de oito símbolos sem
 * significado.
 */
export function AccountCode({ code, className }: { code: string; className?: string }) {
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (!copiado) return;
    const timer = window.setTimeout(() => setCopiado(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copiado]);

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <code
        onClick={(event) => {
          // Um toque seleciona tudo: é a saída de quem não pode usar o botão.
          const faixa = document.createRange();
          faixa.selectNodeContents(event.currentTarget);
          const selecao = window.getSelection();
          selecao?.removeAllRanges();
          selecao?.addRange(faixa);
        }}
        className="cursor-pointer rounded-control bg-surface-sunken px-1.5 py-0.5 text-label tracking-[0.12em] text-ink tabular"
      >
        {code}
      </code>
      <button
        type="button"
        aria-label="Copiar código da conta"
        onClick={async () => {
          const ok = await copyToClipboard(code);
          if (!ok) {
            toast.error("Não consegui copiar. Toque no código para selecionar e copie manualmente.");
            return;
          }
          setCopiado(true);
          toast.success("Código copiado");
        }}
        // O ícone tem 14px, mas o alvo precisa ter o tamanho de um dedo: a
        // área clicável vai a 44px sem empurrar o layout, com margem negativa.
        className="-m-2.5 flex size-11 items-center justify-center rounded-control text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink"
      >
        {copiado ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      </button>
    </span>
  );
}
