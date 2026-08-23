"use client";

import {
  ArrowLeft,
  Building2,
  CreditCard,
  Layers,
  LineChart,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Chrome do painel da plataforma.
 *
 * Deliberadamente escuro, ao contrário do azul do painel da clínica: quem
 * opera os dois precisa saber, em um relance, se está olhando UMA conta ou
 * TODAS elas. Confundir os dois é como confundir o caixa com o cofre.
 */

const NAV = [
  { href: "/admin", label: "Visão do negócio", icon: LineChart, exact: true },
  { href: "/admin/contas", label: "Contas", icon: Building2 },
  { href: "/admin/planos", label: "Planos", icon: Layers },
  { href: "/admin/pagamentos", label: "Pagamentos", icon: CreditCard },
  { href: "/admin/administradores", label: "Administradores", icon: ShieldCheck },
];

export function PlatformShell({
  children,
  user,
}: {
  children: React.ReactNode;
  user: { name: string; email: string };
}) {
  const pathname = usePathname();
  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <nav
        aria-label="Navegação da plataforma"
        className="flex w-full shrink-0 flex-col bg-[#141B34] px-3.5 py-5 md:w-[240px]"
      >
        <div className="px-2 pb-6">
          <span className="block text-[13px] font-bold uppercase tracking-[0.14em] text-white/60">
            Lumina
          </span>
          <span className="mt-0.5 block text-[19px] font-bold leading-6 tracking-[-0.01em] text-white">
            Plataforma
          </span>
        </div>

        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const active = isActive(item.href, item.exact);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-pill px-3 py-2.5 text-label transition-colors duration-[120ms]",
                    active
                      ? "bg-white/15 font-semibold text-white"
                      : "text-white/70 hover:bg-white/10 hover:text-white",
                  )}
                >
                  <item.icon className="size-[18px]" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="flex-1" />

        <Link
          href="/hoje"
          className="mb-2 flex items-center gap-2.5 rounded-pill px-3 py-2.5 text-label text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="size-4" />
          Voltar para a clínica
        </Link>

        <div className="rounded-card bg-white/10 px-3 py-2.5">
          <p className="truncate text-caption font-semibold text-white">{user.name}</p>
          <p className="truncate text-meta text-white/60">{user.email}</p>
          <form action="/api/sair" method="post" className="mt-2">
            <button
              type="submit"
              className="flex items-center gap-1.5 text-meta text-white/70 transition-colors hover:text-white"
            >
              <LogOut className="size-3" />
              Sair
            </button>
          </form>
        </div>
      </nav>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

export function PlatformHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="border-b border-line bg-surface-raised">
      <div className="flex min-h-[76px] w-full max-w-[1240px] flex-wrap items-center justify-between gap-3 px-5 py-4 md:px-8">
        <div className="min-w-0">
          <h1 className="truncate text-title text-ink">{title}</h1>
          {description ? (
            <p className="mt-1 truncate text-caption text-ink-secondary">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function PlatformBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("w-full max-w-[1240px] px-5 py-6 md:px-8 md:py-8", className)}>{children}</div>
  );
}
