"use client";

import { addDays, parseISO } from "date-fns";
import { CalendarCog, CalendarPlus, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { ProfessionalDot, stripeColor } from "@/components/ui/status-stripe";
import { STATUS_LABEL, STATUS_TONE, type AppointmentStatus } from "@/domain/appointment-status";
import { formatTz, formatTzCapitalized } from "@/lib/tz";
import { useCurrentMinute } from "@/lib/use-current-minute";
import { identityTint } from "@/lib/color";
import { cn } from "@/lib/utils";
import { AppointmentSheet } from "./appointment-sheet";
import { AvailabilitySheet, type ScheduleData } from "./availability-sheet";
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

/** Estado do painel de criação: a grade vazia entrega hora e profissional já escolhidos. */
type Creating = { startsAt?: string; professionalId?: number };

/** Cliente que já chega escolhido (link do inbox ou da ficha do cliente). */
export type PresetCustomer = { id: number; name: string; phone: string | null };

const PX_PER_MIN = 14 / 15; // 15 min = 14px
const SNAP_MIN = 15;

export function AgendaView({
  dateISO,
  dayStartUtcISO,
  timezone,
  isToday,
  agenda,
  formData,
  schedule,
  canManageSchedule,
  selectedBranchId,
  openAppointmentId,
  openNew,
  presetCustomer,
}: {
  dateISO: string;
  dayStartUtcISO: string;
  timezone: string;
  isToday: boolean;
  agenda: { appointments: AgendaAppointment[]; columns: Column[]; gridStart: number; gridEnd: number };
  formData: AgendaFormData;
  schedule: ScheduleData;
  canManageSchedule: boolean;
  selectedBranchId: number | null;
  openAppointmentId: number | null;
  openNew: boolean;
  presetCustomer: PresetCustomer | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [navigating, startNavigation] = useTransition();
  const [selectedId, setSelectedId] = useState<number | null>(openAppointmentId);
  const [creating, setCreating] = useState<Creating | null>(openNew ? {} : null);
  // Painel de disponibilidade; `professionalId` null abre no primeiro da lista.
  const [scheduleEditor, setScheduleEditor] = useState<{ professionalId: number | null } | null>(null);
  const [scrolled, setScrolled] = useState(false);

  // O dia mostrado no título muda no clique; o servidor confirma depois.
  // (A página remonta a view a cada dia/atendimento da URL — ver `key` em page.tsx.)
  const [shownDateISO, setShownDateISO] = useState(dateISO);

  const dayStart = useMemo(() => new Date(dayStartUtcISO), [dayStartUtcISO]);
  const selected = agenda.appointments.find((a) => a.id === selectedId) ?? null;

  const ordered = useMemo(
    () => [...agenda.appointments].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [agenda.appointments],
  );

  function navigate(params: URLSearchParams) {
    startNavigation(() => {
      router.push(`/agenda${params.size ? `?${params}` : ""}`);
    });
  }

  function goToDay(offset: number) {
    // Parte do dia já mostrado: dois cliques seguidos avançam dois dias mesmo
    // antes de o servidor responder ao primeiro.
    const next = addDays(parseISO(`${shownDateISO}T12:00:00Z`), offset);
    const nextISO = formatTz(next, "UTC", "yyyy-MM-dd");
    const params = new URLSearchParams(searchParams.toString());
    params.set("dia", nextISO);
    params.delete("atendimento");
    setShownDateISO(nextISO);
    navigate(params);
  }

  function goToToday() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("dia");
    params.delete("atendimento");
    navigate(params);
  }

  /**
   * Fechar o painel de criação também limpa `novo` e `cliente` da URL: sem
   * isso, um F5 depois de agendar reabriria o painel com o mesmo cliente.
   */
  function closeCreation() {
    setCreating(null);
    if (!searchParams.has("novo") && !searchParams.has("cliente")) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("novo");
    params.delete("cliente");
    router.replace(`/agenda${params.size ? `?${params}` : ""}`);
  }

  function setBranch(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("unidade", value);
    else params.delete("unidade");
    navigate(params);
  }

  const minutes = (iso: string) => (new Date(iso).getTime() - dayStart.getTime()) / 60000;
  const hours: number[] = [];
  for (let m = agenda.gridStart; m <= agenda.gridEnd; m += 60) hours.push(m);

  // A linha do agora usa o relógio do cliente e anda sozinha a cada minuto.
  const currentMinute = useCurrentMinute();
  const nowMinutes =
    isToday && currentMinute !== null ? (currentMinute * 60_000 - dayStart.getTime()) / 60_000 : null;

  const showNowLine =
    nowMinutes !== null && nowMinutes >= agenda.gridStart && nowMinutes <= agenda.gridEnd;

  const title = formatTzCapitalized(
    new Date(`${shownDateISO}T12:00:00Z`),
    "UTC",
    "EEEE, d 'de' MMMM",
  );

  const count = agenda.appointments.length;
  const branchName = formData.branches.find((b) => b.id === selectedBranchId)?.name;
  const description = navigating
    ? "Carregando atendimentos…"
    : [
        count === 0 ? "Nenhum atendimento" : `${count} ${count === 1 ? "atendimento" : "atendimentos"}`,
        branchName,
      ]
        .filter(Boolean)
        .join(" · ");

  const gridHeight = (agenda.gridEnd - agenda.gridStart) * PX_PER_MIN;

  /**
   * Clique num espaço livre da coluna: converte a posição do cursor em horário
   * (arredondado para 15 min) e abre o painel já preenchido. É uma camada só —
   * um botão por intervalo criaria dezenas de paradas de teclado inúteis, e o
   * mesmo agendamento continua acessível pelo botão "Novo atendimento".
   */
  function openCreationAt(event: React.MouseEvent<HTMLDivElement>, column: Column) {
    const rect = event.currentTarget.getBoundingClientRect();
    const absolute = agenda.gridStart + (event.clientY - rect.top) / PX_PER_MIN;
    const snapped = Math.floor(absolute / SNAP_MIN) * SNAP_MIN;
    const insideShift =
      (column.workStart === null || snapped >= column.workStart) &&
      (column.workEnd === null || snapped < column.workEnd);
    setCreating({
      professionalId: column.professionalId,
      startsAt: insideShift
        ? new Date(dayStart.getTime() + snapped * 60_000).toISOString()
        : undefined,
    });
  }

  return (
    <div className="flex flex-col md:h-dvh">
      <PageHeader
        title={title}
        description={description}
        actions={
          <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
            <div className="flex items-center gap-1">
              <Button
                variant="secondary"
                size="icon"
                className="size-11 md:size-9"
                onClick={() => goToDay(-1)}
                aria-label="Dia anterior"
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                className="size-11 md:size-9"
                onClick={() => goToDay(1)}
                aria-label="Próximo dia"
              >
                <ChevronRight />
              </Button>
            </div>

            {!isToday ? (
              <Button variant="secondary" className="h-11 md:h-9" onClick={goToToday}>
                Ir para hoje
              </Button>
            ) : null}

            {formData.branches.length > 1 ? (
              <Select
                value={selectedBranchId ?? ""}
                onChange={(e) => setBranch(e.target.value)}
                aria-label="Filtrar por unidade"
                className="h-11 w-[168px] md:h-9"
              >
                <option value="">Todas as unidades</option>
                {formData.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            ) : null}

            {canManageSchedule ? (
              <Button
                variant="secondary"
                className="h-11 md:h-9"
                onClick={() => setScheduleEditor({ professionalId: null })}
                title="Definir os horários em que cada profissional atende"
              >
                <CalendarCog />
                <span className="hidden sm:inline">Disponibilidade</span>
              </Button>
            ) : null}

            <Button
              variant="primary"
              className="h-11 flex-1 md:h-9 sm:flex-none"
              onClick={() => setCreating({})}
            >
              <Plus />
              Novo atendimento
            </Button>
          </div>
        }
      />

      {agenda.columns.length === 0 ? (
        <div className="flex flex-1 items-center justify-center py-10">
          <EmptyState
            icon={CalendarPlus}
            title="Ninguém trabalha neste dia"
            description="Defina a grade de horários dos profissionais para que a agenda passe a receber atendimentos."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                {canManageSchedule ? (
                  <Button variant="primary" size="md" onClick={() => setScheduleEditor({ professionalId: null })}>
                    <CalendarCog />
                    Definir horários
                  </Button>
                ) : null}
                <Button
                  variant={canManageSchedule ? "secondary" : "primary"}
                  size="md"
                  onClick={() => setCreating({})}
                >
                  Criar atendimento mesmo assim
                </Button>
              </div>
            }
          />
        </div>
      ) : (
        <>
          {/* Grade por profissional — só existe onde cabe (>= 768px) */}
          <div
            onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}
            className={cn(
              "hidden min-h-0 flex-1 overflow-auto transition-opacity duration-[120ms] md:block",
              navigating && "pointer-events-none opacity-60",
            )}
          >
            <div className="flex min-w-fit">
              {/* Régua de horas */}
              <div className="sticky left-0 z-20 w-12 shrink-0 border-r border-line bg-surface">
                <div
                  className={cn(
                    "sticky top-0 z-10 h-10 border-b border-line bg-surface",
                    scrolled && "shadow-sticky",
                  )}
                />
                <div className="relative" style={{ height: gridHeight }}>
                  {hours.map((m) => (
                    <span
                      key={m}
                      // Rótulo logo abaixo da linha da hora: nunca é cortado pelo cabeçalho
                      className="absolute right-2 text-meta tabular text-ink-secondary"
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
                  const items = ordered.filter((a) => a.professionalId === column.professionalId);
                  return (
                    <div
                      key={column.professionalId}
                      className="min-w-[180px] flex-1 border-r border-line last:border-r-0"
                    >
                      <div
                        className={cn(
                          "sticky top-0 z-10 flex h-10 items-center gap-2 border-b border-line bg-surface px-3",
                          scrolled && "shadow-sticky",
                        )}
                      >
                        <ProfessionalDot color={column.color} />
                        <span className="truncate text-label text-ink">{column.name}</span>
                      </div>

                      <div className="relative" style={{ height: gridHeight }}>
                        {/* Camada de criação: clicar no vazio abre o painel com hora e profissional */}
                        <div
                          aria-hidden
                          className="absolute inset-0 cursor-copy"
                          onClick={(e) => openCreationAt(e, column)}
                        />

                        {/* linhas de hora */}
                        {hours.map((m) => (
                          <div
                            key={m}
                            className="pointer-events-none absolute inset-x-0 border-t border-line"
                            style={{ top: (m - agenda.gridStart) * PX_PER_MIN }}
                          />
                        ))}

                        {/* fora da jornada */}
                        {column.workStart !== null && column.workStart > agenda.gridStart ? (
                          <div
                            className="pointer-events-none absolute inset-x-0 bg-surface-sunken/60"
                            style={{
                              top: 0,
                              height: (column.workStart - agenda.gridStart) * PX_PER_MIN,
                            }}
                          />
                        ) : null}
                        {column.workEnd !== null && column.workEnd < agenda.gridEnd ? (
                          <div
                            className="pointer-events-none absolute inset-x-0 bg-surface-sunken/60"
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

                        {items.map((appointment) => (
                          <AppointmentBlock
                            key={appointment.id}
                            appointment={appointment}
                            timezone={timezone}
                            selected={appointment.id === selectedId}
                            top={(minutes(appointment.startsAt) - agenda.gridStart) * PX_PER_MIN}
                            height={Math.max(
                              (minutes(appointment.endsAt) - minutes(appointment.startsAt)) *
                                PX_PER_MIN,
                              26,
                            )}
                            onSelect={() => setSelectedId(appointment.id)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Lista cronológica — a agenda do celular. A grade não existe aqui. */}
          <div
            className={cn(
              "pb-6 transition-opacity duration-[120ms] md:hidden",
              navigating && "pointer-events-none opacity-60",
            )}
          >
            {ordered.length === 0 ? (
              <EmptyState
                icon={CalendarPlus}
                title="Nenhum atendimento neste dia"
                description="A agenda está livre. Marque o primeiro atendimento do dia ou navegue para outra data."
                action={
                  <Button variant="primary" size="md" onClick={() => setCreating({})}>
                    <Plus />
                    Novo atendimento
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-line border-b border-line">
                {ordered.map((appointment) => {
                  const status = appointment.status as AppointmentStatus;
                  return (
                    <li key={appointment.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(appointment.id)}
                        className="flex min-h-[60px] w-full items-center gap-3 border-l-[3px] py-2.5 pl-3 pr-4 text-left"
                        style={{ borderLeftColor: stripeColor(appointment.status) }}
                      >
                        <time className="w-11 shrink-0 text-label tabular text-ink-secondary">
                          {formatTz(new Date(appointment.startsAt), timezone, "HH:mm")}
                        </time>
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "block truncate text-label text-ink",
                              (status === "cancelled" || status === "no_show") && "line-through",
                            )}
                          >
                            {appointment.customerName}
                          </span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-caption text-ink-secondary">
                            <ProfessionalDot color={appointment.professionalColor} />
                            <span className="truncate">
                              {appointment.serviceName} · {appointment.professionalName.split(" ")[0]}
                            </span>
                          </span>
                        </span>
                        <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {selected ? (
        <AppointmentSheet
          appointment={selected}
          timezone={timezone}
          professionals={formData.professionals}
          onClose={() => setSelectedId(null)}
        />
      ) : null}

      {creating ? (
        <NewAppointmentSheet
          dateISO={dateISO}
          timezone={timezone}
          formData={formData}
          defaultProfessionalId={creating.professionalId}
          defaultStartsAt={creating.startsAt}
          defaultCustomer={presetCustomer}
          onClose={closeCreation}
        />
      ) : null}

      {scheduleEditor ? (
        <AvailabilitySheet
          timezone={timezone}
          formData={formData}
          schedule={schedule}
          defaultProfessionalId={scheduleEditor.professionalId}
          onClose={() => setScheduleEditor(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Bloco da grade. A faixa de 3px é STATUS; a cor do profissional vira o fundo
 * suave e o ponto. Hora e nome são dois níveis distintos — varrer a coluna
 * atrás de um horário não pode exigir ler palavra por palavra.
 */
function AppointmentBlock({
  appointment,
  timezone,
  selected,
  top,
  height,
  onSelect,
}: {
  appointment: AgendaAppointment;
  timezone: string;
  selected: boolean;
  top: number;
  height: number;
  onSelect: () => void;
}) {
  const status = appointment.status as AppointmentStatus;
  const off = status === "cancelled" || status === "no_show";
  const startLabel = formatTz(new Date(appointment.startsAt), timezone, "HH:mm");
  const endLabel = formatTz(new Date(appointment.endsAt), timezone, "HH:mm");

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${appointment.customerName}, ${appointment.serviceName}, ${startLabel} às ${endLabel}, ${STATUS_LABEL[status]}`}
      className={cn(
        "absolute inset-x-1 overflow-hidden rounded-control border-l-[3px] px-2 py-1 text-left transition-[box-shadow,background-color] duration-[120ms] hover:z-10 hover:shadow-sticky focus-visible:z-10",
        selected && "ring-2 ring-accent",
      )}
      style={{
        top,
        height,
        borderLeftColor: stripeColor(appointment.status),
        backgroundColor: off
          ? "var(--color-surface-sunken)"
          : identityTint(appointment.professionalColor, 0.94).background,
      }}
    >
      <span className="flex items-center gap-1.5">
        <ProfessionalDot color={appointment.professionalColor} />
        <time className="shrink-0 text-meta tabular text-ink-secondary">{startLabel}</time>
        <span className={cn("truncate text-label text-ink", off && "line-through")}>
          {appointment.customerName}
        </span>
      </span>
      {height >= 44 ? (
        <span className="mt-0.5 block truncate text-meta text-ink-secondary">
          {appointment.serviceName}
        </span>
      ) : null}
      {height >= 60 || (off && height >= 44) ? (
        <span className="block truncate text-meta text-ink-secondary">{STATUS_LABEL[status]}</span>
      ) : null}
    </button>
  );
}
