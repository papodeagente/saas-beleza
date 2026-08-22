"use client";

import { CalendarPlus, Receipt } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ProfessionalDot, stripeColor } from "@/components/ui/status-stripe";
import { STATUS_LABEL, STATUS_TONE, type AppointmentStatus } from "@/domain/appointment-status";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

export type TabAppointment = {
  id: number;
  startsAtLabel: string;
  timeLabel: string;
  status: string;
  priceCents: number;
  paidCents: number;
  serviceName: string;
  professionalName: string;
  professionalColor: string;
  branchName: string;
};

export type TabPayment = {
  id: number;
  dateLabel: string;
  amountCents: number;
  methodLabel: string;
  serviceName: string | null;
};

type TabKey = "proximos" | "historico" | "financeiro";

export function CustomerTabs({
  upcoming,
  past,
  paymentsList,
  totalPaidCents,
}: {
  upcoming: TabAppointment[];
  past: TabAppointment[];
  paymentsList: TabPayment[];
  totalPaidCents: number;
}) {
  const [tab, setTab] = useState<TabKey>(upcoming.length > 0 ? "proximos" : "historico");

  const tabs: Array<{ key: TabKey; label: string; count: number }> = [
    { key: "proximos", label: "Próximos", count: upcoming.length },
    { key: "historico", label: "Histórico", count: past.length },
    { key: "financeiro", label: "Pagamentos", count: paymentsList.length },
  ];

  return (
    <section>
      <div className="flex gap-1 border-b border-line" role="tablist" aria-label="Registros do cliente">
        {tabs.map((item) => {
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(item.key)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-label transition-colors duration-[120ms] pointer-coarse:min-h-11",
                active
                  ? "border-accent font-medium text-accent"
                  : "border-transparent text-ink-secondary hover:text-ink",
              )}
            >
              {item.label}
              <span className="ml-1.5 tabular text-caption text-ink-tertiary">{item.count}</span>
            </button>
          );
        })}
      </div>

      <div className="pt-4" role="tabpanel">
        {tab === "proximos" ? (
          upcoming.length === 0 ? (
            <EmptyState
              icon={CalendarPlus}
              title="Sem horário marcado"
              description="Esta cliente não tem nenhum atendimento agendado. É a hora de chamar."
              action={
                <Button variant="primary" size="md" asChild>
                  <Link href="/agenda">Abrir agenda</Link>
                </Button>
              }
            />
          ) : (
            <AppointmentList items={upcoming} />
          )
        ) : null}

        {tab === "historico" ? (
          past.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="Ainda sem histórico"
              description="O que acontecer nos atendimentos aparece aqui, do mais recente para o mais antigo."
            />
          ) : (
            <AppointmentList items={past} />
          )
        ) : null}

        {tab === "financeiro" ? (
          paymentsList.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="Nenhum pagamento registrado"
              description="Os pagamentos lançados nos atendimentos desta cliente aparecem aqui."
            />
          ) : (
            <div className="overflow-hidden rounded-card bg-surface-raised shadow-card">
              <ul className="divide-y divide-line">
                {paymentsList.map((payment) => (
                  <li key={payment.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="w-24 shrink-0 tabular text-caption text-ink-secondary">
                      {payment.dateLabel}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-label text-ink">
                        {payment.serviceName ?? "Pagamento avulso"}
                      </span>
                      <span className="block text-caption text-ink-secondary">
                        {payment.methodLabel}
                      </span>
                    </span>
                    <span className="shrink-0 tabular text-label text-positive">
                      {formatBRL(payment.amountCents)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between border-t border-line bg-surface px-4 py-2.5">
                <span className="text-label text-ink">Total recebido</span>
                <span className="tabular text-label font-semibold text-ink">
                  {formatBRL(totalPaidCents)}
                </span>
              </div>
            </div>
          )
        ) : null}
      </div>
    </section>
  );
}

function AppointmentList({ items }: { items: TabAppointment[] }) {
  return (
    <div className="overflow-hidden rounded-card bg-surface-raised shadow-card">
      <ul className="divide-y divide-line">
        {items.map((item) => {
          const open = item.priceCents - item.paidCents;
          return (
            <li key={item.id} className="relative flex items-center gap-3 py-3 pl-4 pr-4">
              {/* Faixa de 3px = status, em toda lista de atendimento do produto */}
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-[3px]"
                style={{ backgroundColor: stripeColor(item.status) }}
              />
              <span className="w-[92px] shrink-0">
                <span className="block tabular text-label text-ink">{item.startsAtLabel}</span>
                <span className="block tabular text-caption text-ink-secondary">{item.timeLabel}</span>
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-label text-ink">{item.serviceName}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-caption text-ink-secondary">
                  <ProfessionalDot color={item.professionalColor} />
                  {item.professionalName.split(" ")[0]} · {item.branchName}
                </span>
              </span>

              <Badge tone={STATUS_TONE[item.status as keyof typeof STATUS_TONE]}>
                {STATUS_LABEL[item.status as AppointmentStatus]}
              </Badge>

              <span className="w-24 shrink-0 text-right">
                <span className="block tabular text-label text-ink">{formatBRL(item.priceCents)}</span>
                {open > 0 && item.status === "completed" ? (
                  <span className="block tabular text-caption text-attention">
                    {formatBRL(open)} em aberto
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
