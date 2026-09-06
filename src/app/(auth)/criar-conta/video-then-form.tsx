"use client";

import { useState } from "react";
import { BrandLogo } from "@/components/brand";
import { ExplainerVideo } from "@/components/explainer-video";
import { AuthShell } from "../auth-shell";

/**
 * Vídeo antes do formulário — não depois.
 *
 * A `AuthShell` (a moldura do formulário) reserva só 360px pra coluna de
 * conteúdo — de propósito, é o tanto que um campo de e-mail precisa, e
 * é estreito demais pra um vídeo. Por isso a fase de vídeo usa a própria
 * largura da tela, na "noite" da marca (mesma linguagem do site público);
 * só depois de decidido é que a tela estreita, pro tamanho de formulário.
 *
 * `revealed` é estado só desta visita: não precisa lembrar entre sessões
 * que a pessoa já viu — se ela sair e voltar depois pra terminar o
 * cadastro, ver de novo não incomoda quem ainda nem é cliente.
 */
export function VideoThenForm({ children, trialDays }: { children: React.ReactNode; trialDays: number }) {
  const [revealed, setRevealed] = useState(false);

  if (revealed) {
    return <AuthShell>{children}</AuthShell>;
  }

  return (
    <div className="min-h-dvh bg-night px-6 py-10 lg:py-14">
      <div className="mx-auto max-w-[880px]">
        <BrandLogo variant="white" />

        <div className="mt-10 text-center">
          <h1 className="text-display text-night-ink">Antes de começar, veja como funciona</h1>
          <p className="mx-auto mt-2 max-w-[46ch] text-body text-night-ink-secondary">
            Um vídeo rápido mostrando o sistema por dentro — depois é só preencher seus dados e
            começar os {trialDays} dias grátis.
          </p>
        </div>

        <div className="mt-8">
          <ExplainerVideo onFinish={() => setRevealed(true)} />
        </div>

        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="mx-auto mt-6 block text-label text-night-ink-tertiary transition-colors hover:text-night-ink"
        >
          Já conheço — pular e preencher meus dados →
        </button>
      </div>
    </div>
  );
}
