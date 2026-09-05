"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/lib/clipboard";

/**
 * O link público é o ativo que a clínica mais compartilha — copiar o endereço
 * inteiro precisa ser um toque, não uma seleção de texto.
 */
export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    // Fora de HTTPS o navegador não expõe a área de transferência moderna; o
    // helper cuida da reserva.
    const ok = await copyToClipboard(url);
    if (!ok) {
      toast.error("Não foi possível copiar. Selecione o endereço e copie manualmente.");
      return;
    }
    setCopied(true);
    toast.success("Link copiado");
  }

  return (
    <Button
      variant="primary"
      onClick={copy}
      className="h-11 min-w-[132px] md:h-9"
      aria-label={`Copiar link de agendamento: ${url}`}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? "Link copiado" : "Copiar link"}
    </Button>
  );
}
