"use client";

import { addDays, format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarPlus, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useCurrentMinute } from "@/lib/use-current-minute";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, STATUS_TONE, type AppointmentStatus } from "@/domain/appointment-status";
import { AppointmentSheet } from "./appointment-sheet";
import { NewAppointmentSheet } from "./new-appointment-sheet";

export type AgendaAppointment = {
  id: number;
  startsAt: string;
  endsAt: string;
  status: string;
  priceCents: number;
  source: string;
  customerId: number;
  customerName: string;
  customerPhone: string | null;
  serviceName: string;
  professionalId: number;
  professionalName: string;
  professionalColor: string;
  branchName: string;
  paidCents: number;
};

type Column = {
  professionalId: number;
  name: string;
  color: string;
  workStart: number | null;
  workEnd: number | null;
};

export type AgendaFormData = {
  services: Array<{ id: number; name: string; durationMin: number; priceCents: number }>;
  professionals: Array<{ id: number; name: string; color: string }>;
  branches: Array<{ id: number; name: string }>;
};

const PX_PER_MIN = 14 / 15; // 15 min = 14px

export function AgendaView({
  dateISO,
  dayStartUtcISO,
  isToday,
  agenda,
  formData,
  selectedBranchId,
  openAppointmentId,
}: {
  dateISO: string;
  dayStartUtcISO: string;
  isToday: boolean;
  agenda: { appointments: AgendaAppointment[]; columns: Column[]; gridStart: number; gridEnd: number };
  formData: AgendaFormData;
  selectedBranchId: number | null;
  openAppointmentId: number | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<number | null>(openAppointmentId);
  const [creating, setCreating] = useState<{ startsAt?: string; professionalId?: number } | null>(null);

  const dayStart = useMemo(() => new Date(dayStartUtcISO), [dayStartUtcISO]);
  const selected = agenda.appointments.find((a) => a.id === selectedId) ?? null;

  function goToDay(offset: number) {
    const next = addDays(parseISO(`${dateISO}T12:00:00Z`), offset);
    const params = new URLSearchParams(searchParams.toString());
    params.set("dia", format(next, "yyyy-MM-dd"));
    params.delete("atendimento");
    router.push(`/agenda?${params.toString()}`);
  }

  function goToToday() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("dia");
    params.delete("atendimento");
    router.push(`/agenda${params.size ? `?${params}` : ""}`);
  }

  function setBranch(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("unidade", value);
    else params.delete("unidade");
    router.push(`/agenda?${params.toString()}`);
  }

  const minutes = (iso: string) => (new Date(iso).getTime() - dayStart.getTime()) / 60000;
  const hours: number[] = [];
  for (let m = agenda.gridStart; m <= agenda.gridEnd; m += 60) hours.push(m);

  // A linha do agora usa o relógio do cliente e anda sozinha a cada minuto.
  const currentMinute = useCurrentMinute();
  const nowMinutes =
    isToday && currentMinute !== null
      ? (currentMinute * 60_000 - dayStart.getTime()) / 60_000
      : null;

  const showNowLine =
    nowMinutes !== null && nowMinutes >= agenda.gridStart && nowMinutes <= agenda.gridEnd;

  const headerDate = format(parseISO(`${dateISO}T12:00:00Z`), "EEEE, d 'de' MMMM", { locale: ptBR });

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3 md:px-6">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon" onClick={() => goToDay(-1)} aria-label="Dia anterior">
              <ChevronLeft />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => goToDay(1)} aria-label="Próximo dia">
              <ChevronRight />
            </Button>
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold leading-5 tracking-[-0.01em] text-ink">
              {headerDate.charAt(0).toUpperCase() + headerDate.slice(1)}
            </h1>
            <p className="text-[12px] text-ink-tertiary">
              {agenda.appointments.length === 0
                ? "Nenhum atendimento"
                : `${agenda.appointments.length} ${agenda.appointments.length === 1 ? "atendimento" : "atendimentos"}`}
            </p>
          </div>
          {!isToday ? (
            <Button variant="secondary" size="sm" onClick={goToToday}>
              Ir para hoje
            </Button>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {formData.branches.length > 1 ? (
            <select
              value={selectedBranchId ?? ""}
              onChange={(e) => setBranch(e.target.value)}
              aria-label="Filtrar por unidade"
              className="h-8 rounded-[var(--radius-sm)] border border-line-strong bg-surface-raised px-2 text-[13px] text-ink"
            >
              <option value="">Todas as unidades</option>
              {formData.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          ) : null}
          <Button variant="primary" size="sm" onClick={() => setCreating({})}>
            <Plus />
            Novo atendimento
          </Button>
        </div>
      </header>

      {agenda.columns.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={CalendarPlus}
            title="Ninguém trabalha neste dia"
            description="Defina a grade de horários dos profissionais para que a agenda passe a receber atendimentos."
            action={
              <Button variant="primary" size="md" onClick={() => setCreating({})}>
                Criar atendimento mesmo assim
              </Button>
            }
          />
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <div className="flex min-w-fit">
            {/* Régua de horas */}
            <div className="sticky left-0 z-20 w-12 shrink-0 border-r border-line bg-surface">
              <div className="h-10 border-b border-line" />
              <div className="relative" style={{ height: (agenda.gridEnd - agenda.gridStart) * PX_PER_MIN }}>
                {hours.map((m) => (
                  <span
                    key={m}
                    // Rótulo logo abaixo da linha da hora: nunca é cortado pelo cabeçalho
                    className="absolute right-2 text-[11px] leading-4 tabular text-ink-tertiary"
                    style={{ top: (m - agenda.gridStart) * PX_PER_MIN + 2 }}
                  >
                    {String(Math.floor(m / 60)).padStart(2, "0")}h
                  </span>
                ))}
              </div>
            </div>

            {/* Colunas por profissional */}
            <div className="flex flex-1">
              {agenda.columns.map((column) => {
                const items = agenda.appointments.filter((a) => a.professionalId === column.professionalId);
                return (
                  <div
                    key={column.professionalId}
                    className="min-w-[180px] flex-1 border-r border-line last:border-r-0"
                  >
                    <div className="sticky top-0 z-10 flex h-10 items-center gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur">
                      <span
                        aria-hidden
                        className="size-2 rounded-full"
                        style={{ backgroundColor: column.color }}
                      />
                      <span className="truncate text-[13px] font-medium text-ink">{column.name}</span>
                    </div>

                    <div
                      className="relative"
                      style={{ height: (agenda.gridEnd - agenda.gridStart) * PX_PER_MIN }}
                    >
                      {/* linhas de hora */}
                      {hours.map((m) => (
                        <div
                          key={m}
                          className="absolute inset-x-0 border-t border-line"
                          style={{ top: (m - agenda.gridStart) * PX_PER_MIN }}
                        />
                      ))}

                      {/* fora da jornada */}
                      {column.workStart !== null && column.workStart > agenda.gridStart ? (
                        <div
                          className="absolute inset-x-0 bg-surface-sunken/60"
                          style={{
                            top: 0,
                            height: (column.workStart - agenda.gridStart) * PX_PER_MIN,
                          }}
                        />
                      ) : null}
                      {column.workEnd !== null && column.workEnd < agenda.gridEnd ? (
                        <div
                          className="absolute inset-x-0 bg-surface-sunken/60"
                          style={{
                            top: (column.workEnd - agenda.gridStart) * PX_PER_MIN,
                            height: (agenda.gridEnd - column.workEnd) * PX_PER_MIN,
                          }}
                        />
                      ) : null}

                      {/* linha do agora */}
                      {showNowLine ? (
                        <div
                          className="pointer-events-none absolute inset-x-0 z-10 border-t border-accent"
                          style={{ top: (nowMinutes! - agenda.gridStart) * PX_PER_MIN }}
                        >
                          <span className="absolute -left-0.5 -top-[3px] size-1.5 rounded-full bg-accent" />
                        </div>
                      ) : null}

                      {items.map((appointment) => {
                        const top = (minutes(appointment.startsAt) - agenda.gridStart) * PX_PER_MIN;
                        const height = Math.max(
                          (minutes(appointment.endsAt) - minutes(appointment.startsAt)) * PX_PER_MIN,
                          26,
                        );
                        const cancelled = appointment.status === "cancelled" || appointment.status === "no_show";
                        return (
                          <button
                            key={appointment.id}
                            type="button"
                            onClick={() => setSelectedId(appointment.id)}
                            className={cn(
                              "absolute inset-x-1 overflow-hidden rounded-[var(--radius-sm)] border-l-[3px] px-2 py-1 text-left transition-[filter,box-shadow] duration-[120ms] hover:z-10 hover:shadow-[var(--shadow-raised)] focus-visible:z-10",
                              cancelled ? "opacity-55" : "",
                            )}
                            style={{
                              top,
                              height,
                              borderLeftColor: appointment.professionalColor,
                              backgroundColor: `${appointment.professionalColor}12`,
                            }}
                          >
                            <span className="block truncate text-[12px] font-medium leading-4 text-ink">
                              <span className="tabular">
                                {format(new Date(appointment.startsAt), "HH:mm")}
                              </span>{" "}
                              {appointment.customerName}
                            </span>
                            {height > 34 ? (
                              <span className="block truncate text-[11px] leading-4 text-ink-secondary">
                                {appointment.serviceName}
                              </span>
                            ) : null}
                            {cancelled ? (
                              <span className="block truncate text-[10px] leading-4 text-danger">
                                {STATUS_LABEL[appointment.status as AppointmentStatus]}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Lista compacta — mobile */}
          <div className="border-t border-line md:hidden">
            {agenda.appointments.map((appointment) => (
              <button
                key={appointment.id}
                type="button"
                onClick={() => setSelectedId(appointment.id)}
                className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left"
              >
                <time className="w-11 shrink-0 text-[13px] font-medium tabular text-ink">
                  {format(new Date(appointment.startsAt), "HH:mm")}
                </time>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{appointment.customerName}</span>
                  <span className="block truncate text-[12px] text-ink-tertiary">
                    {appointment.serviceName} · {appointment.professionalName.split(" ")[0]}
                  </span>
                </span>
                <Badge tone={STATUS_TONE[appointment.status as keyof typeof STATUS_TONE]}>
                  {STATUS_LABEL[appointment.status as AppointmentStatus]}
                </Badge>
              </button>
            ))}
          </div>
        </div>
      )}

      {selected ? (
        <AppointmentSheet appointment={selected} onClose={() => setSelectedId(null)} />
      ) : null}

      {creating ? (
        <NewAppointmentSheet
          dateISO={dateISO}
          formData={formData}
          defaultProfessionalId={creating.professionalId}
          onClose={() => setCreating(null)}
        />
      ) : null}
    </div>
  );
}

