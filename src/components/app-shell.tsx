"use client";

import {
  ArrowRight,
  Workflow,
  Bell,
  Bot,
  CalendarDays,
  Check,
  LayoutGrid,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  ChevronDown,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  User,
  Users,
  UsersRound,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { Role } from "@/server/auth";
import { BrandLogo } from "@/components/brand";

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
  { href: "/grupos", label: "Grupos", icon: UsersRound, group: "operacao", minRole: "staff" },
  { href: "/whatsapp", label: "WhatsApp", icon: Smartphone, group: "gestao", minRole: "admin" },
  { href: "/agente", label: "Agente de IA", icon: Bot, group: "gestao", minRole: "admin" },
  { href: "/automacoes", label: "Automações", icon: Workflow, group: "gestao", minRole: "admin" },
  { href: "/financeiro", label: "Financeiro", icon: Wallet, group: "gestao", minRole: "admin" },
  { href: "/catalogo", label: "Catálogo", icon: LayoutGrid, group: "gestao", minRole: "staff" },
  { href: "/gestao", label: "Gestão", icon: Settings, group: "gestao", minRole: "admin" },
];

const RANK: Record<Role, number> = { professional: 0, staff: 1, admin: 2, owner: 3 };

export function AppShell({
  children,
  user,
  signals,
  isPlatformAdmin = false,
}: {
  children: React.ReactNode;
  user: { name: string; email: string; role: Role };
  signals: Signal[];
  /**
   * Vem do servidor (`platform_admins`), nunca do papel na clínica. Esconder o
   * item no cliente é cortesia visual, não proteção: quem digitar /admin sem
   * autorização é barrado pelo layout do painel, que consulta a tabela.
   */
  isPlatformAdmin?: boolean;
}) {
  const pathname = usePathname();
  const [panel, setPanel] = useState<"none" | "avisos" | "mais" | "usuario" | "gestao">("none");
  // Fecha qualquer painel ao trocar de rota. Ajuste durante o render (padrão
  // documentado do React) em vez de efeito: evita o render em cascata.
  const [panelPath, setPanelPath] = useState(pathname);
  if (panelPath !== pathname) {
    setPanelPath(pathname);
    setPanel("none");
  }

  const visible = NAV.filter((item) => RANK[user.role] >= RANK[item.minRole]);
  const operacao = visible.filter((i) => i.group === "operacao");
  const gestao = visible.filter((i) => i.group === "gestao");
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const mobilePrimary = visible.slice(0, 4);
  const mobileRest = visible.slice(4);

  return (
    /**
     * Navegação no topo, não na lateral.
     *
     * Lateral custa largura o tempo todo, e há tela que precisa dessa largura
     * mais do que precisa do menu: o Inbox põe lista, conversa e ficha do
     * cliente lado a lado, e com a coluna de menu a conversa ficava com um
     * quarto da janela — o campo de escrever chegava a 170px. A barra superior
     * devolve esse espaço a todas as telas e não cobra nada em troca, porque
     * altura é o que sobra num monitor.
     */
    <div className="flex min-h-dvh flex-col" style={{ "--topbar-h": "56px" } as React.CSSProperties}>
      <nav
        aria-label="Navegação principal"
        className="bg-brand sticky top-0 z-40 hidden h-[56px] shrink-0 items-center gap-4 px-4 md:flex"
      >
        <Link href="/hoje" className="flex shrink-0 items-center">
          <BrandLogo compact className="text-white" iconClassName="size-7" />
        </Link>

        <ul className="flex min-w-0 flex-1 items-center gap-0.5">
          {operacao.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                title={item.label}
                className={cn(
                  "flex items-center gap-2 rounded-pill px-3 py-2 text-label transition-colors duration-[120ms]",
                  isActive(item.href)
                    ? "bg-white/25 font-semibold text-white"
                    : "text-white/85 hover:bg-white/12 hover:text-white",
                )}
              >
                <item.icon className="size-4 shrink-0" />
                {/* Abaixo de 1100px sobra o ícone: dez rótulos não cabem sem
                    espremer a barra e o título da tela. */}
                <span className="hidden xl:inline">{item.label}</span>
              </Link>
            </li>
          ))}

          {gestao.length > 0 ? (
            <li className="relative ml-1 border-l border-white/20 pl-2">
              <button
                type="button"
                onClick={() => setPanel(panel === "gestao" ? "none" : "gestao")}
                aria-expanded={panel === "gestao"}
                className={cn(
                  "flex items-center gap-2 rounded-pill px-3 py-2 text-label transition-colors duration-[120ms]",
                  panel === "gestao" || gestao.some((i) => isActive(i.href))
                    ? "bg-white/25 font-semibold text-white"
                    : "text-white/85 hover:bg-white/12 hover:text-white",
                )}
              >
                <Settings className="size-4 shrink-0" />
                <span className="hidden lg:inline">Configurar</span>
                <ChevronDown className="size-3.5 shrink-0" />
              </button>
              {panel === "gestao" ? (
                <DropdownPanel onClose={() => setPanel("none")} className="w-[220px] p-1">
                  {gestao.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={isActive(item.href) ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-control px-2.5 py-2 text-label transition-colors",
                        isActive(item.href)
                          ? "bg-accent-soft font-semibold text-accent"
                          : "text-ink-secondary hover:bg-surface-sunken hover:text-ink",
                      )}
                    >
                      <item.icon className="size-4 shrink-0" />
                      {item.label}
                    </Link>
                  ))}
                </DropdownPanel>
              ) : null}
            </li>
          ) : null}
        </ul>

        {/* Avisos: mesma fonte da tela Hoje */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setPanel(panel === "avisos" ? "none" : "avisos")}
            aria-expanded={panel === "avisos"}
            aria-label="Avisos"
            className={cn(
              "flex items-center gap-2 rounded-pill px-3 py-2 text-label transition-colors duration-[120ms]",
              panel === "avisos" ? "bg-white/20 text-white" : "text-white/85 hover:bg-white/12 hover:text-white",
            )}
          >
            <Bell className="size-4" />
            {signals.length > 0 ? (
              <span className="inline-flex min-w-[20px] items-center justify-center rounded-pill bg-white px-1.5 text-meta font-bold text-accent tabular">
                {signals.length}
              </span>
            ) : null}
          </button>
          {panel === "avisos" ? <SignalPanel signals={signals} onClose={() => setPanel("none")} /> : null}
        </div>

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setPanel(panel === "usuario" ? "none" : "usuario")}
            aria-expanded={panel === "usuario"}
            className="flex items-center gap-2 rounded-pill py-1 pr-2 pl-1 text-left transition-colors hover:bg-white/15"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-pill bg-white/90 text-meta font-bold text-accent">
              {user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
            </span>
            <span className="hidden min-w-0 lg:block">
              <span className="block max-w-[140px] truncate text-caption font-semibold text-white">{user.name}</span>
              <span className="block text-meta text-white/70">{ROLE_LABEL[user.role]}</span>
            </span>
          </button>
          {panel === "usuario" ? <UserMenu isPlatformAdmin={isPlatformAdmin} /> : null}
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
          isPlatformAdmin={isPlatformAdmin}
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

/** Caixa flutuante ancorada abaixo do gatilho, fechando ao clicar fora. */
function DropdownPanel({
  children,
  onClose,
  className,
}: {
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
}) {
  return (
    <>
      <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-40 cursor-default" onClick={onClose} />
      <div
        className={cn(
          "animate-dialog-in absolute top-full left-0 z-50 mt-1 rounded-card border border-line bg-surface-raised shadow-[var(--shadow-overlay)]",
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}

function SignalPanel({ signals, onClose }: { signals: Signal[]; onClose: () => void }) {
  return (
    <div className="animate-dialog-in absolute top-full right-0 z-50 mt-1 w-[288px] overflow-hidden rounded-card border border-line bg-surface-raised shadow-[var(--shadow-overlay)]">
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

function UserMenu({ isPlatformAdmin }: { isPlatformAdmin: boolean }) {
  return (
    <div className="animate-dialog-in absolute top-full right-0 z-50 mt-1 w-[236px] rounded-card border border-line bg-surface-raised p-1 shadow-[var(--shadow-overlay)]">
      <Link
        href="/conta"
        className="flex items-center gap-2 rounded-control px-2 py-1.5 text-label text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink"
      >
        <User className="size-3.5" />
        Minha conta
      </Link>

      {/* Sai do escopo da clínica e entra no do SaaS. Fica separado por uma
          linha justamente para não ser confundido com uma opção da conta. */}
      {isPlatformAdmin ? (
        <div className="my-1 border-t border-line pt-1">
          <Link
            href="/admin"
            className="flex items-center gap-2 rounded-control px-2 py-1.5 text-label text-accent transition-colors hover:bg-accent-soft"
          >
            <ShieldCheck className="size-3.5" />
            Administrar a plataforma
          </Link>
          <p className="px-2 pt-0.5 pb-1 text-meta leading-4 text-ink-tertiary">
            Todas as clínicas e o faturamento do SaaS.
          </p>
        </div>
      ) : null}
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
  isPlatformAdmin = false,
}: {
  isPlatformAdmin?: boolean;
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
          {isPlatformAdmin ? (
            <li>
              <Link
                href="/admin"
                className="flex min-h-[52px] items-center gap-3 px-4 text-body text-accent"
              >
                <ShieldCheck className="size-[18px]" />
                Administrar a plataforma
              </Link>
            </li>
          ) : null}
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
    <header className="border-b border-line bg-surface-raised">
      <div className="flex min-h-[76px] w-full max-w-[1180px] flex-wrap items-center justify-between gap-3 px-5 py-4 md:px-8">
        <div className="min-w-0">
          <h1 className={cn("truncate text-ink", entity ? "text-entity" : "text-title")}>{title}</h1>
          {description ? (
            <p className="mt-1 truncate text-caption text-ink-secondary">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
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
