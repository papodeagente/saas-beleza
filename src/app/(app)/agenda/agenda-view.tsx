"use client";

import { addDays, addMonths, addWeeks, parseISO } from "date-fns";
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
import { diasDoIntervaloUtc, formatTz, formatTzCapitalized } from "@/lib/tz";
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
type ViewMode = "dia" | "semana" | "mes";

/** Cliente que já chega escolhido (link do inbox ou da ficha do cliente). */
export type PresetCustomer = { id: number; name: string; phone: string | null };

const PX_PER_MIN = 14 / 15; // 15 min = 14px
const SNAP_MIN = 15;

export function AgendaView({
  dateISO,
  viewMode,
  rangeStartISO,
  rangeEndISO,
  rangeAppointments,
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
  viewMode: ViewMode;
  rangeStartISO: string;
  rangeEndISO: string;
  rangeAppointments: AgendaAppointment[];
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
  const shownDateISO = dateISO;

  const dayStart = useMemo(() => new Date(dayStartUtcISO), [dayStartUtcISO]);
  const selected = agenda.appointments.find((a) => a.id === selectedId) ?? rangeAppointments.find((a) => a.id === selectedId) ?? null;

  const ordered = useMemo(
    () => [...agenda.appointments].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [agenda.appointments],
  );

  function navigate(params: URLSearchParams) {
    startNavigation(() => {
      router.push(`/agenda${params.size ? `?${params}` : ""}`);
    });
  }

  function goToPeriod(offset: number) {
    const anchor = parseISO(`${shownDateISO}T12:00:00Z`);
    const next = viewMode === "mes" ? addMonths(anchor, offset) : viewMode === "semana" ? addWeeks(anchor, offset) : addDays(anchor, offset);
    const params = new URLSearchParams(searchParams.toString());
    params.set("dia", formatTz(next, "UTC", "yyyy-MM-dd"));
    params.delete("atendimento");
    navigate(params);
  }

  function setViewMode(mode: ViewMode) {
    const params = new URLSearchParams(searchParams.toString());
    // Semana também vai para a URL. Antes o parâmetro era apagado porque
    // "semana" era o padrão implícito; agora o padrão depende do aparelho
    // (celular abre em dia), e apagar faria a escolha explícita do usuário
    // voltar sozinha para dia no próximo render.
    params.set("visualizacao", mode);
    params.delete("atendimento");
    navigate(params);
  }

  function openDay(date: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("dia", date);
    params.set("visualizacao", "dia");
    params.delete("atendimento");
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

  const title = viewMode === "mes"
    ? formatTzCapitalized(new Date(`${shownDateISO}T12:00:00Z`), "UTC", "MMMM 'de' yyyy")
    : viewMode === "semana"
      ? `${formatTzCapitalized(new Date(`${rangeStartISO}T12:00:00Z`), "UTC", "d MMM")} – ${formatTz(new Date(`${rangeEndISO}T12:00:00Z`), "UTC", "d MMM yyyy")}`
      : formatTzCapitalized(new Date(`${shownDateISO}T12:00:00Z`), "UTC", "EEEE, d 'de' MMMM");

  const visibleAppointments = viewMode === "dia" ? agenda.appointments : rangeAppointments;
  const count = visibleAppointments.length;
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
    <div className="flex flex-col md:h-[calc(100dvh_-_var(--topbar-h,56px))]">
      <PageHeader
        title="Agenda"
        description={description}
        actions={
          <Button variant="primary" className="h-10" onClick={() => setCreating({})}>
            <Plus />
            Novo
          </Button>
        }
      />

      <div className="flex min-h-14 flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2 md:px-6">
        <Button variant="secondary" size="sm" onClick={goToToday} disabled={isToday}>Hoje</Button>
        <div className="flex items-center">
          <Button variant="ghost" size="icon" className="size-9" onClick={() => goToPeriod(-1)} aria-label={viewMode === "mes" ? "Mês anterior" : viewMode === "semana" ? "Semana anterior" : "Dia anterior"}><ChevronLeft /></Button>
          <Button variant="ghost" size="icon" className="size-9" onClick={() => goToPeriod(1)} aria-label={viewMode === "mes" ? "Próximo mês" : viewMode === "semana" ? "Próxima semana" : "Próximo dia"}><ChevronRight /></Button>
        </div>
        {/* No celular a data ganha a própria linha. Espremida entre o botão
            Hoje, as setas e o seletor de visualização sobravam ~80px para ela,
            e "Segunda, 24 de agosto" virava "Seg…" — a tela deixava de dizer
            que dia está aberto, que é a única informação obrigatória aqui. */}
        <h2 className="order-first w-full min-w-0 truncate text-body font-semibold text-ink sm:order-none sm:w-auto sm:flex-1 md:text-card">{title}</h2>
        {formData.branches.length > 1 ? (
          /**
           * O `hidden sm:block` precisa ficar no ENVOLTÓRIO, não no <select>.
           *
           * O Select desenha a própria seta como filho absoluto de um <div
           * relative>; escondendo só o <select>, a seta continuava aparecendo —
           * era um "⌄" solto no meio da barra do celular, em cima do título do
           * dia, que ainda perdia largura para um controle invisível.
           *
           * Largura automática entre 150 e 220: em 150 fixo "Todas as unidades"
           * saía cortado no "unidade".
           */
          <div className="hidden sm:block">
            <Select value={selectedBranchId ?? ""} onChange={(e) => setBranch(e.target.value)} aria-label="Filtrar por unidade" className="h-9 w-auto min-w-[150px] max-w-[220px]">
              <option value="">Todas as unidades</option>
              {formData.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </div>
        ) : null}
        {canManageSchedule ? (
          <Button variant="ghost" size="icon" className="size-9" onClick={() => setScheduleEditor({ professionalId: null })} title="Disponibilidade" aria-label="Configurar disponibilidade"><CalendarCog /></Button>
        ) : null}
        <Select value={viewMode} onChange={(event) => setViewMode(event.target.value as ViewMode)} aria-label="Visualização da agenda" className="h-9 w-[112px]">
          <option value="dia">Dia</option>
          <option value="semana">Semana</option>
          <option value="mes">Mês</option>
        </Select>
      </div>

      {viewMode !== "dia" ? (
        <RangeAgenda
          mode={viewMode}
          anchorISO={shownDateISO}
          startISO={rangeStartISO}
          endISO={rangeEndISO}
          appointments={rangeAppointments}
          timezone={timezone}
          navigating={navigating}
          onOpenDay={openDay}
          onSelect={setSelectedId}
        />
      ) : agenda.columns.length === 0 ? (
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

function RangeAgenda({
  mode,
  anchorISO,
  startISO,
  endISO,
  appointments,
  timezone,
  navigating,
  onOpenDay,
  onSelect,
}: {
  mode: Exclude<ViewMode, "dia">;
  anchorISO: string;
  startISO: string;
  endISO: string;
  appointments: AgendaAppointment[];
  timezone: string;
  navigating: boolean;
  onOpenDay: (dateISO: string) => void;
  onSelect: (id: number) => void;
}) {
  const days = diasDoIntervaloUtc(startISO, endISO);
  const anchor = parseISO(`${anchorISO}T12:00:00Z`);
  const byDay = new Map<string, AgendaAppointment[]>();
  for (const appointment of appointments) {
    const key = formatTz(new Date(appointment.startsAt), timezone, "yyyy-MM-dd");
    byDay.set(key, [...(byDay.get(key) ?? []), appointment]);
  }

  if (mode === "semana") {
    return (
      <div className={cn("grid min-w-0 flex-1 grid-cols-7 gap-px bg-line", navigating && "pointer-events-none opacity-60")}>
        {days.slice(0, 7).map((day) => {
          const date = formatTz(day, "UTC", "yyyy-MM-dd");
          const items = byDay.get(date) ?? [];
          return (
            <section key={date} className="min-w-0 bg-surface">
              <button type="button" onClick={() => onOpenDay(date)} className="flex w-full flex-col items-center border-b border-line px-1 py-2 text-center hover:bg-surface-sunken sm:flex-row sm:justify-between sm:px-2 sm:text-left">
                <span className="truncate text-meta font-semibold text-ink sm:text-label">{formatTzCapitalized(day, "UTC", "EEE")}</span>
                <span className="text-meta tabular text-ink-secondary">{formatTz(day, "UTC", "dd")}</span>
              </button>
              <div className="space-y-1 p-1 sm:p-1.5">
                {items.length ? items.map((appointment) => (
                  <RangeAppointment key={appointment.id} appointment={appointment} timezone={timezone} compact onSelect={() => onSelect(appointment.id)} />
                )) : <span className="block py-3 text-center text-meta text-ink-tertiary">—</span>}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn("min-h-0 flex-1 overflow-auto", navigating && "pointer-events-none opacity-60")}>
      <div className="min-w-[760px]">
        <div className="grid grid-cols-7 border-b border-line bg-surface-sunken">
          {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((label) => <div key={label} className="px-2 py-2 text-center text-meta font-semibold uppercase tracking-wide text-ink-secondary">{label}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-px bg-line">
          {days.map((day) => {
            const date = formatTz(day, "UTC", "yyyy-MM-dd");
            const items = byDay.get(date) ?? [];
            // Mês comparado em UTC, e não com `isSameMonth`, que responde no
            // fuso do navegador: no dia 1º e no dia 31 as duas respostas
            // divergem, e a célula acendia ou apagava conforme quem olhasse.
            const muted =
              formatTz(day, "UTC", "yyyy-MM") !== formatTz(anchor, "UTC", "yyyy-MM");
            return (
              <section key={date} className={cn("min-h-32 bg-surface p-1.5", muted && "bg-surface-sunken/70")}>
                <button type="button" onClick={() => onOpenDay(date)} className={cn("mb-1 flex size-7 items-center justify-center rounded-full text-caption tabular hover:bg-accent-soft hover:text-accent", muted ? "text-ink-tertiary" : "text-ink")} aria-label={`Abrir ${formatTz(day, "UTC", "dd/MM/yyyy")}`}>
                  {formatTz(day, "UTC", "d")}
                </button>
                <div className="space-y-1">
                  {items.slice(0, 3).map((appointment) => <RangeAppointment key={appointment.id} appointment={appointment} timezone={timezone} compact onSelect={() => onSelect(appointment.id)} />)}
                  {items.length > 3 ? <button type="button" onClick={() => onOpenDay(date)} className="px-1 text-meta font-semibold text-accent">+{items.length - 3} outros</button> : null}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RangeAppointment({ appointment, timezone, compact = false, onSelect }: { appointment: AgendaAppointment; timezone: string; compact?: boolean; onSelect: () => void }) {
  const status = appointment.status as AppointmentStatus;
  const off = status === "cancelled" || status === "no_show";
  const tint = identityTint(appointment.professionalColor);
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full overflow-hidden rounded-control border-l-[3px] px-2 py-1.5 text-left hover:shadow-card"
      style={{ borderLeftColor: stripeColor(appointment.status), backgroundColor: tint.background }}
      aria-label={`${formatTz(new Date(appointment.startsAt), timezone, "HH:mm")}, ${appointment.customerName}, ${appointment.serviceName}`}
    >
      <span className="block text-meta font-semibold tabular text-ink">{formatTz(new Date(appointment.startsAt), timezone, "HH:mm")}</span>
      <span className={cn("block truncate text-caption text-ink", off && "line-through")}>{appointment.customerName}</span>
      {!compact ? <span className="block truncate text-meta text-ink-secondary">{appointment.serviceName} · {appointment.professionalName.split(" ")[0]}</span> : null}
    </button>
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
