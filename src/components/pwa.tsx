"use client";

import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Instalação do aplicativo.
 *
 * O produto está sendo construído para virar app, e o primeiro degrau é o mais
 * barato: a PWA já instalável, com service worker registrado e um convite que
 * aparece na hora certa.
 *
 * DUAS DECISÕES QUE VALEM ESTAR ESCRITAS
 *
 * 1. O convite não aparece de cara. `beforeinstallprompt` dispara na primeira
 *    visita, e um banner de instalar antes de a pessoa ver o que o produto faz
 *    é a definição de atrito. Ele espera a segunda visita — que já é sinal de
 *    interesse.
 *
 * 2. A recusa é lembrada. Quem fecha o convite não deve vê-lo de novo por
 *    trinta dias. Banner que volta toda visita é o que faz alguém desinstalar
 *    o site da vida.
 *
 * O iOS não implementa `beforeinstallprompt` — lá a instalação é pelo menu
 * Compartilhar do Safari. Por isso o componente não promete o que não pode
 * cumprir: sem o evento, não há convite.
 */

type PromptDeInstalacao = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const CHAVE_VISITAS = "adu:visitas";
const CHAVE_RECUSA = "adu:instalar-recusado";
const DIAS_DE_SILENCIO = 30;

export function PWA() {
  const [convite, setConvite] = useState<PromptDeInstalacao | null>(null);

  // Registro do service worker. Só em produção: em desenvolvimento ele
  // atrapalha o hot reload e mascara mudanças que não estão sendo aplicadas.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const id = window.setTimeout(() => {
      // Depois da carga, não durante: registrar cedo disputa banda com o que a
      // pessoa está esperando ver.
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }, 1_500);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    let visitas = 0;
    try {
      visitas = Number(localStorage.getItem(CHAVE_VISITAS) ?? "0") + 1;
      localStorage.setItem(CHAVE_VISITAS, String(visitas));
    } catch {
      // Navegador com armazenamento bloqueado (aba anônima, política de site).
      // Sem contador não há convite — e tudo bem: é um extra, não o produto.
      return;
    }

    function aoPoderInstalar(evento: Event) {
      evento.preventDefault();
      if (visitas < 2) return;
      try {
        const recusadoEm = Number(localStorage.getItem(CHAVE_RECUSA) ?? "0");
        if (recusadoEm && Date.now() - recusadoEm < DIAS_DE_SILENCIO * 86_400_000) return;
      } catch {
        return;
      }
      setConvite(evento as PromptDeInstalacao);
    }

    window.addEventListener("beforeinstallprompt", aoPoderInstalar);
    return () => window.removeEventListener("beforeinstallprompt", aoPoderInstalar);
  }, []);

  function recusar() {
    try {
      localStorage.setItem(CHAVE_RECUSA, String(Date.now()));
    } catch {
      // Sem memória da recusa o convite volta — irritante, não quebrado.
    }
    setConvite(null);
  }

  async function instalar() {
    if (!convite) return;
    await convite.prompt();
    await convite.userChoice;
    setConvite(null);
  }

  if (!convite) return null;

  return (
    <div
      role="dialog"
      aria-label="Instalar o aplicativo"
      className="fixed inset-x-3 bottom-3 z-50 flex items-center gap-3 rounded-card border border-line bg-surface-raised p-3 shadow-[var(--shadow-overlay)] sm:left-auto sm:right-4 sm:w-[360px]"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-card bg-accent-soft text-accent">
        <Download aria-hidden className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-label text-ink">Instalar o Agenda de Unha</p>
        <p className="mt-0.5 text-caption text-ink-secondary">
          Abre direto da tela de início, sem passar pelo navegador.
        </p>
      </div>
      <Button variant="primary" onClick={instalar}>
        Instalar
      </Button>
      <button
        type="button"
        onClick={recusar}
        aria-label="Agora não"
        className="flex size-11 shrink-0 items-center justify-center rounded-control text-ink-tertiary transition-colors hover:text-ink"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}
