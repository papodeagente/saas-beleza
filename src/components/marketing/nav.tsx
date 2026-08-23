"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { CtaButton } from "./primitives";

const LINKS = [
  { href: "#produto", label: "Produto" },
  { href: "#agente", label: "Agente de IA" },
  { href: "#preco", label: "Preço" },
  { href: "#perguntas", label: "Perguntas" },
];

/**
 * Barra fixa da landing.
 *
 * Nasce transparente sobre o hero e ganha fundo depois dos primeiros 24px de
 * rolagem. O motivo é prático: sobre a manchete ela competiria com o título, e
 * sobre o conteúdo ela precisa de fundo para o texto continuar legível.
 *
 * Não existe estado de "logado" aqui de propósito. Consultar a sessão faria
 * esta página virar renderização dinâmica, e cada visita anônima passaria a
 * custar uma consulta ao banco. Quem já tem sessão clica em "Entrar" e a
 * própria tela de login o manda para dentro do produto.
 */
export function MarketingNav({ ctaHref, ctaLabel }: { ctaHref: string; ctaLabel: string }) {
  const [rolou, setRolou] = useState(false);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    const aoRolar = () => setRolou(window.scrollY > 24);
    aoRolar();
    window.addEventListener("scroll", aoRolar, { passive: true });
    return () => window.removeEventListener("scroll", aoRolar);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-colors duration-300",
        rolou || aberto
          ? "border-b border-night-line bg-night/85 backdrop-blur-xl"
          : "border-b border-transparent",
      )}
    >
      <nav
        aria-label="Principal"
        className="mx-auto flex h-[72px] w-full max-w-[1200px] items-center gap-6 px-[clamp(20px,4vw,32px)]"
      >
        <Link href="/" className="shrink-0 text-title font-extrabold tracking-[0.1em] text-night-ink">
          LUMINA
        </Link>

        <ul className="ml-4 hidden flex-1 items-center gap-7 lg:flex">
          {LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="text-label text-night-ink-secondary transition-colors hover:text-night-ink"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <Link
            href="/entrar"
            className="rounded-control px-3 py-2 text-label text-night-ink transition-colors hover:bg-white/8"
          >
            Entrar
          </Link>
          <CtaButton href={ctaHref} className="hidden h-10 px-4 text-label sm:inline-flex">
            {ctaLabel}
          </CtaButton>

          <button
            type="button"
            aria-expanded={aberto}
            aria-label={aberto ? "Fechar menu" : "Abrir menu"}
            onClick={() => setAberto((v) => !v)}
            className="rounded-control p-2 text-night-ink transition-colors hover:bg-white/8 lg:hidden"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              {aberto ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </nav>

      {aberto ? (
        <div className="border-t border-night-line px-[clamp(20px,4vw,32px)] py-4 lg:hidden">
          <ul className="space-y-1">
            {LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={() => setAberto(false)}
                  className="block rounded-control px-3 py-2.5 text-card text-night-ink-secondary transition-colors hover:bg-white/8 hover:text-night-ink"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          <CtaButton href={ctaHref} className="mt-3 w-full">
            {ctaLabel}
          </CtaButton>
        </div>
      ) : null}
    </header>
  );
}
