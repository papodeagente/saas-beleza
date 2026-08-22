"use client";

import {
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  LayoutGrid,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Settings,
  Sparkles,
  User,
  Users,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { Role } from "@/server/auth";

export type Signal = {
  id: string;
  label: string;
  detail?: string;
  tone: "attention" | "danger" | "info";
  href: string;
  actionLabel: string;
};

/**
 * Navegação em dois blocos: o que se usa todo dia e o que se ajusta de vez em
 * quando. `minRole` decide quem enxerga — a recepção não vê o financeiro da
 * clínica nem a comissão dos colegas.
 */
const NAV: Array<{
  href: string;
  label: string;
  icon: typeof Sparkles;
  group: "operacao" | "gestao";
  minRole: Role;
}> = [
  { href: "/hoje", label: "Hoje", icon: Sparkles, group: "operacao", minRole: "professional" },
  { href: "/agenda", label: "Agenda", icon: CalendarDays, group: "operacao", minRole: "professional" },
  { href: "/clientes", label: "Clientes", icon: Users, group: "operacao", minRole: "staff" },
  { href: "/inbox", label: "Inbox", icon: MessageSquare, group: "operacao", minRole: "staff" },
  { href: "/financeiro", label: "Financeiro", icon: Wallet, group: "gestao", minRole: "admin" },
  { href: "/catalogo", label: "Catálogo", icon: LayoutGrid, group: "gestao", minRole: "staff" },
  { href: "/gestao", label: "Gestão", icon: Settings, group: "gestao", minRole: "admin" },
];

const RANK: Record<Role, number> = { professional: 0, staff: 1, admin: 2, owner: 3 };

export function AppShell({
  children,
  user,
  organization,
  signals,
}: {
  children: React.ReactNode;
  user: { name: string; email: string; role: Role };
  organization: { name: string };
  signals: Signal[];
}) {
  const pathname = usePathname();
  const [panel, setPanel] = useState<"none" | "avisos" | "mais" | "usuario">("none");

  const visible = NAV.filter((item) => RANK[user.role] >= RANK[item.minRole]);
  const operacao = visible.filter((i) => i.group === "operacao");
  const gestao = visible.filter((i) => i.group === "gestao");
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  // Fecha qualquer painel ao trocar de rota
  useEffect(() => setPanel("none"), [pathname]);

  const mobilePrimary = visible.slice(0, 4);
  const mobileRest = visible.slice(4);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <nav
        aria-label="Navegação principal"
        className="hidden w-[216px] shrink-0 flex-col border-r border-line bg-surface px-3 py-4 md:flex"
      >
        {/* Marca do produto — separada da clínica atendida */}
        <div className="px-2 pb-5">
          <span className="font-display text-[17px] leading-6 font-[600] tracking-[-0.01em] text-ink">
            Lumina
          </span>
          <span className="mt-0.5 block truncate text-caption text-ink-secondary">
            {organization.name}
          </span>
        </div>

        <NavGroup items={operacao} isActive={isActive} />
        {gestao.length > 0 ? (
          <>
            <div className="my-3 border-t border-line" />
            <NavGroup items={gestao} isActive={isActive} />
          </>
        ) : null}

        <div className="flex-1" />

        {/* Avisos: mesma fonte da tela Hoje */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setPanel(panel === "avisos" ? "none" : "avisos")}
            aria-expanded={panel === "avisos"}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-label transition-colors duration-[120ms]",
              panel === "avisos"
                ? "bg-surface-sunken text-ink"
                : "text-ink-secondary hover:bg-surface-sunken hover:text-ink",
            )}
          >
            <Bell className="size-4 text-ink-tertiary" />
            Avisos
            {signals.length > 0 ? (
              <span className="ml-auto inline-flex min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-meta font-medium text-white tabular">
                {signals.length}
              </span>
            ) : null}
          </button>
          {panel === "avisos" ? (
            <SignalPanel signals={signals} onClose={() => setPanel("none")} />
          ) : null}
        </div>

        <div className="relative mt-1 border-t border-line pt-2">
          <button
            type="button"
            onClick={() => setPanel(panel === "usuario" ? "none" : "usuario")}
            aria-expanded={panel === "usuario"}
            className="flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-surface-sunken"
          >
            <Avatar name={user.name} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-caption font-medium text-ink">{user.name}</span>
              <span className="block truncate text-meta text-ink-secondary">{ROLE_LABEL[user.role]}</span>
            </span>
          </button>
          {panel === "usuario" ? <UserMenu /> : null}
        </div>
      </nav>

      <main className="min-w-0 flex-1 pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-0">
        {children}
      </main>

      {/* Navegação inferior — 4 destinos + "Mais" com o restante e a conta */}
      <nav
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface-raised/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {mobilePrimary.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item.href) ? "page" : undefined}
            className={cn(
              "flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-meta transition-colors",
              isActive(item.href) ? "text-accent" : "text-ink-secondary",
            )}
          >
            <item.icon className="size-[18px]" />
            {item.label}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setPanel(panel === "mais" ? "none" : "mais")}
          aria-expanded={panel === "mais"}
          className={cn(
            "flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-meta transition-colors",
            panel === "mais" ? "text-accent" : "text-ink-secondary",
          )}
        >
          <MoreHorizontal className="size-[18px]" />
          Mais
        </button>
      </nav>

      {panel === "mais" ? (
        <MobileMore
          items={mobileRest}
          signals={signals}
          user={user}
          isActive={isActive}
          onClose={() => setPanel("none")}
        />
      ) : null}
    </div>
  );
}

const ROLE_LABEL: Record<Role, string> = {
  owner: "Proprietária",
  admin: "Administração",
  staff: "Recepção",
  professional: "Profissional",
};

function NavGroup({
  items,
  isActive,
}: {
  items: Array<{ href: string; label: string; icon: typeof Sparkles }>;
  isActive: (href: string) => boolean;
}) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const active = isActive(item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-control px-2 py-1.5 text-label transition-colors duration-[120ms]",
                active
                  ? "bg-accent-soft font-medium text-accent"
                  : "text-ink-secondary hover:bg-surface-sunken hover:text-ink",
              )}
            >
              <item.icon className={cn("size-4", active ? "text-accent" : "text-ink-tertiary")} />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function SignalPanel({ signals, onClose }: { signals: Signal[]; onClose: () => void }) {
  return (
    <div className="animate-dialog-in absolute bottom-full left-0 z-50 mb-1 w-[288px] overflow-hidden rounded-card border border-line bg-surface-raised shadow-[var(--shadow-overlay)]">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-section">Avisos</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar avisos"
          className="rounded-control p-1 text-ink-tertiary hover:bg-surface-sunken hover:text-ink"
        >
          <X className="size-3.5" />
        </button>
      </div>
      {signals.length === 0 ? (
        <p className="flex items-center gap-2 px-3 py-4 text-caption text-ink-secondary">
          <Check className="size-3.5 text-positive" />
          Nada pendente por aqui.
        </p>
      ) : (
        <ul className="max-h-[320px] divide-y divide-line overflow-y-auto">
          {signals.map((signal) => (
            <li key={signal.id}>
              <Link href={signal.href} className="group flex gap-2.5 px-3 py-2.5 hover:bg-surface-sunken">
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                    signal.tone === "danger" && "bg-danger",
                    signal.tone === "attention" && "bg-attention",
                    signal.tone === "info" && "bg-info",
                  )}
                />
                <span className="min-w-0">
                  <span className="block text-caption text-ink">{signal.label}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-meta text-ink-secondary group-hover:text-accent">
                    {signal.actionLabel}
                    <ArrowRight className="size-3" />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UserMenu() {
  return (
    <div className="animate-dialog-in absolute bottom-full left-0 z-50 mb-1 w-[196px] rounded-card border border-line bg-surface-raised p-1 shadow-[var(--shadow-overlay)]">
      <Link
        href="/conta"
        className="flex items-center gap-2 rounded-control px-2 py-1.5 text-label text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink"
      >
        <User className="size-3.5" />
        Minha conta
      </Link>
      <form action="/api/sair" method="post">
        <button
          type="submit"
          className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-label text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink"
        >
          <LogOut className="size-3.5" />
          Sair
        </button>
      </form>
    </div>
  );
}

function MobileMore({
  items,
  signals,
  user,
  isActive,
  onClose,
}: {
  items: Array<{ href: string; label: string; icon: typeof Sparkles }>;
  signals: Signal[];
  user: { name: string; role: Role };
  isActive: (href: string) => boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button
        type="button"
        aria-label="Fechar menu"
        onClick={onClose}
        className="animate-overlay-in absolute inset-0 bg-ink/20 backdrop-blur-[2px]"
      />
      <div className="animate-dialog-in absolute inset-x-0 bottom-0 rounded-t-overlay border-t border-line bg-surface-raised pb-[calc(12px+env(safe-area-inset-bottom))]">
        <div className="mx-auto my-2.5 h-1 w-9 rounded-full bg-line-strong" />

        <div className="flex items-center gap-2.5 border-b border-line px-4 pb-3">
          <Avatar name={user.name} size="md" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-label font-medium text-ink">{user.name}</span>
            <span className="block text-caption text-ink-secondary">{ROLE_LABEL[user.role]}</span>
          </span>
        </div>

        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                className="flex min-h-[52px] items-center gap-3 px-4 text-body text-ink"
              >
                <item.icon className="size-[18px] text-ink-tertiary" />
                {item.label}
              </Link>
            </li>
          ))}
          <li>
            <Link href="/hoje" className="flex min-h-[52px] items-center gap-3 px-4 text-body text-ink">
              <Bell className="size-[18px] text-ink-tertiary" />
              Avisos
              {signals.length > 0 ? (
                <span className="ml-auto inline-flex min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-meta font-medium text-white tabular">
                  {signals.length}
                </span>
              ) : null}
            </Link>
          </li>
          <li>
            <Link href="/conta" className="flex min-h-[52px] items-center gap-3 px-4 text-body text-ink">
              <User className="size-[18px] text-ink-tertiary" />
              Minha conta
            </Link>
          </li>
          <li>
            <form action="/api/sair" method="post">
              <button
                type="submit"
                className="flex min-h-[52px] w-full items-center gap-3 px-4 text-body text-ink"
              >
                <LogOut className="size-[18px] text-ink-tertiary" />
                Sair
              </button>
            </form>
          </li>
        </ul>
      </div>
    </div>
  );
}

/**
 * Cabeçalho de módulo. Único em todas as rotas — antes eram cinco tratamentos
 * diferentes de título, e o chrome pulava a cada navegação.
 */
export function PageHeader({
  title,
  description,
  actions,
  entity = false,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** Nome de entidade (ficha do cliente) usa um degrau acima do nome de módulo. */
  entity?: boolean;
}) {
  return (
    <header className="border-b border-line">
      <div className="flex min-h-[60px] w-full max-w-[1180px] flex-wrap items-center justify-between gap-3 px-5 py-3 md:px-8">
        <div className="min-w-0">
          <h1 className={cn("truncate text-ink", entity ? "text-entity" : "text-title")}>{title}</h1>
          {description ? (
            <p className="mt-0.5 truncate text-caption text-ink-secondary">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/**
 * Corpo da página. Ancorado à esquerda: a sidebar já é a margem, centralizar
 * criaria uma segunda margem que cresce com a tela (500px mortos em 1920).
 */
export function PageBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("w-full max-w-[1180px] px-5 py-6 md:px-8 md:py-8", className)}>{children}</div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="text-section">{children}</h2>;
}
