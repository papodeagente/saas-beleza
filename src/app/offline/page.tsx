import { WifiOff } from "lucide-react";

/**
 * A página que o service worker serve quando não há rede.
 *
 * Ela não mostra agenda nem horário guardado de propósito: dado de
 * disponibilidade desatualizado é pior que ausência de dado — leva a cliente a
 * escolher uma vaga que já foi ocupada e a concluir que o site não funciona.
 */
export const metadata = { title: "Sem conexão" };

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-surface px-5 text-center">
      <span className="flex size-14 items-center justify-center rounded-pill bg-accent-soft text-accent">
        <WifiOff aria-hidden className="size-6" />
      </span>
      <h1 className="mt-5 text-display text-ink">Sem conexão</h1>
      <p className="mt-2 max-w-prose text-body text-ink-secondary">
        Não conseguimos falar com o servidor. Os horários mudam o tempo todo, então preferimos não
        mostrar uma agenda antiga — assim que a internet voltar, é só recarregar.
      </p>
    </main>
  );
}
