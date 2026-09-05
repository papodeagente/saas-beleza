"use client";

import { RotateCw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Erro de módulo. Diz o que houve, qual o impacto e como sair — nunca
 * "algo deu errado".
 */
export default function ModuleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <div className="max-w-[42ch] text-center">
        <h1 className="text-entity text-ink">
          Esta tela não conseguiu carregar
        </h1>
        <p className="mt-2 text-body text-ink-secondary">
          Seus dados estão salvos — o que falhou foi a leitura. Tentar de novo costuma resolver;
          se insistir, a agenda e o Inbox continuam funcionando normalmente.
        </p>
        {error.digest ? (
          <p className="mt-3 text-meta text-ink-tertiary">
            {/* "Código do erro", não "código para suporte": o produto agora tem
                também o código da conta, e dois códigos com o mesmo nome viram
                a pergunta "qual código?" no meio do atendimento. */}
            Código do erro: <span className="tabular">{error.digest}</span>
          </p>
        ) : null}
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button variant="primary" size="md" onClick={reset}>
            <RotateCw />
            Tentar de novo
          </Button>
          <Button variant="secondary" size="md" asChild>
            <Link href="/hoje">Voltar para Hoje</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
