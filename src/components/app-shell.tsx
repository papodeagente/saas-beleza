"use client";

import {
  CalendarDays,
  LayoutGrid,
  LogOut,
  MessageSquare,
  Settings,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/hoje", label: "Hoje", icon: Sparkles },
  { href: "/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/inbox", label: "Inbox", icon: MessageSquare },
  { href: "/financeiro", label: "Financeiro", icon: Wallet },
  { href: "/catalogo", label: "Catálogo", icon: LayoutGrid },
  { href: "/gestao", label: "Gestão", icon: Settings },
];

export function AppShell({
  children,
  user,
  organization,
}: {
  children: React.ReactNode;
  user: { name: string; email: string };
  organization: { name: string };
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Navegação lateral — desktop */}
      <nav
        aria-label="Navegação principal"
        className="hidden w-[212px] shrink-0 flex-col border-r border-line bg-surface px-3 py-4 md:flex"
      >
        <div className="flex items-center gap-2 px-2 pb-5">
          <span className="flex size-6 items-center justify-center rounded-[7px] bg-accent text-[11px] font-semibold text-white">
            L
          </span>
          <span className="truncate text-[13px] font-semibold text-ink">{organization.name}</span>
        </div>

        <ul className="flex-1 space-y-0.5">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-[13px] transition-colors duration-[120ms]",
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

        <div className="relative border-t border-line pt-3">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition-colors hover:bg-surface-sunken"
            aria-expanded={menuOpen}
          >
            <Avatar name={user.name} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium text-ink">{user.name}</span>
            </span>
          </button>
          {menuOpen ? (
            <div className="animate-dialog-in absolute bottom-full left-2 mb-1 w-[180px] rounded-[var(--radius)] border border-line bg-surface-raised p-1 shadow-[var(--shadow-overlay)]">
              <form action="/api/sair" method="post">
                <button
                  type="submit"
                  className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-[13px] text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink"
                >
                  <LogOut className="size-3.5" />
                  Sair
                </button>
              </form>
            </div>
          ) : null}
        </div>
      </nav>

      <main className="min-w-0 flex-1 pb-16 md:pb-0">{children}</main>

      {/* Navegação inferior — mobile. Só o essencial operacional. */}
      <nav
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface-raised/95 backdrop-blur md:hidden"
      >
        {NAV.slice(0, 5).map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] transition-colors",
                active ? "text-accent" : "text-ink-tertiary",
              )}
            >
              <item.icon className="size-[18px]" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5 md:px-8">
      <div className="min-w-0">
        <h1 className="truncate text-[17px] font-semibold leading-6 tracking-[-0.01em] text-ink">{title}</h1>
        {description ? <p className="mt-0.5 text-[12px] text-ink-tertiary">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">{children}</h2>
  );
}
