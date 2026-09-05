"use client";

import { Check, Copy, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  WEEKDAYS,
  WEEKDAY_LABEL,
  type TimeRange,
  describeDay,
  minutesOfTime,
  toHHmm,
  validateDayRanges,
} from "@/domain/working-hours";
import { formatTz, localDateTimeToUtc } from "@/lib/tz";
import { createBlockAction, removeBlockAction, saveWorkingHoursAction } from "./availability-actions";
import type { AgendaFormData } from "./agenda-view";

export type ScheduleHour = {
  id: number;
  professionalId: number;
  branchId: number;
  weekday: number;
  startTime: string;
  endTime: string;
};

export type ScheduleBlock = {
  id: number;
  professionalId: number;
  branchId: number | null;
  startsAt: string;
  endsAt: string;
  reason: string | null;
};

export type ScheduleData = { hours: ScheduleHour[]; blocks: ScheduleBlock[] };

/** Sete listas de períodos, do domingo ao sábado. */
type Week = TimeRange[][];

const EMPTY_WEEK = (): Week => WEEKDAYS.map(() => []);

/** Fim sugerido do período novo, sem passar da meia-noite. */
function plusHours(time: string, hours: number): string {
  const total = Math.min(minutesOfTime(time) + hours * 60, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function weekFromHours(hours: ScheduleHour[], professionalId: number | null, branchId: number | null): Week {
  const week = EMPTY_WEEK();
  if (!professionalId || !branchId) return week;
  for (const hour of hours) {
    if (hour.professionalId !== professionalId || hour.branchId !== branchId) continue;
    week[hour.weekday].push({ startTime: toHHmm(hour.startTime), endTime: toHHmm(hour.endTime) });
  }
  return week;
}

/**
 * Edição da disponibilidade: jornada semanal e bloqueios pontuais.
 *
 * Nasceu de um buraco real do produto — a grade só existia no seed, então
 * quem instalava o sistema não conseguia abrir um único horário, e sem
 * horário aberto não há agendamento nem por dentro, nem pelo link público,
 * nem pelo agente de IA. É a mesma tabela que os três leem.
 */
export function AvailabilitySheet({
  timezone,
  formData,
  schedule,
  defaultProfessionalId,
  onClose,
}: {
  timezone: string;
  formData: AgendaFormData;
  schedule: ScheduleData;
  defaultProfessionalId?: number | null;
  onClose: () => void;
}) {
  const [professionalId, setProfessionalId] = useState<number | null>(
    defaultProfessionalId ?? formData.professionals[0]?.id ?? null,
  );
  const [branchId, setBranchId] = useState<number | null>(formData.branches[0]?.id ?? null);

  const serverWeek = useMemo(
    () => weekFromHours(schedule.hours, professionalId, branchId),
    [schedule.hours, professionalId, branchId],
  );

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      {/* Trocar de profissional/unidade — ou salvar e o servidor devolver dados
          novos — remonta o editor em vez de sincronizar estado dentro de um
          efeito, que é o padrão do resto do produto. */}
      <ScheduleEditor
        key={`${professionalId}:${branchId}:${JSON.stringify(serverWeek)}`}
        timezone={timezone}
        formData={formData}
        hours={schedule.hours}
        blocks={schedule.blocks}
        professionalId={professionalId}
        onProfessionalChange={setProfessionalId}
        branchId={branchId}
        onBranchChange={setBranchId}
        serverWeek={serverWeek}
        onClose={onClose}
      />
    </Sheet>
  );
}

function ScheduleEditor({
  timezone,
  formData,
  hours: allHours,
  blocks: allBlocks,
  professionalId,
  onProfessionalChange,
  branchId,
  onBranchChange,
  serverWeek,
  onClose,
}: {
  timezone: string;
  formData: AgendaFormData;
  hours: ScheduleHour[];
  blocks: ScheduleBlock[];
  professionalId: number | null;
  onProfessionalChange: (value: number | null) => void;
  branchId: number | null;
  onBranchChange: (value: number | null) => void;
  serverWeek: Week;
  onClose: () => void;
}) {
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  const [blocking, startBlocking] = useTransition();
  const [week, setWeek] = useState<Week>(serverWeek);

  const errors = useMemo(() => week.map((ranges) => validateDayRanges(ranges)), [week]);

  /**
   * Dia vazio aqui pode ser dia cheio na outra unidade. Sem dizer isso, a tela
   * afirma "não atende" sobre alguém que atende — e o erro seria descoberto
   * pelo cliente, na hora de agendar.
   */
  const elsewhere = useMemo(() => {
    const byWeekday: string[][] = [[], [], [], [], [], [], []];
    if (!professionalId) return byWeekday;
    for (const hour of allHours) {
      if (hour.professionalId !== professionalId || hour.branchId === branchId) continue;
      const name = formData.branches.find((b) => b.id === hour.branchId)?.name;
      if (name && !byWeekday[hour.weekday].includes(name)) byWeekday[hour.weekday].push(name);
    }
    return byWeekday;
  }, [allHours, professionalId, branchId, formData.branches]);
  const hasError = errors.some(Boolean);

  function updateDay(weekday: number, next: TimeRange[]) {
    setWeek((current) => current.map((ranges, index) => (index === weekday ? next : ranges)));
  }

  function addRange(weekday: number) {
    const ranges = week[weekday];
    // O período novo começa onde o anterior terminou: um clique já entrega
    // algo plausível, e o caso comum (parada para almoço) fica a um ajuste.
    const last = ranges[ranges.length - 1];
    const startTime = last ? toHHmm(last.endTime) : "09:00";
    const endTime = last ? plusHours(startTime, 4) : "18:00";
    updateDay(weekday, [...ranges, { startTime, endTime }]);
  }

  function copyToOtherWorkingDays(weekday: number) {
    const source = week[weekday];
    setWeek((current) =>
      current.map((ranges, index) =>
        index === weekday || ranges.length === 0 ? ranges : source.map((r) => ({ ...r })),
      ),
    );
  }

  const workingDays = week.filter((ranges) => ranges.length > 0).length;

  function save() {
    if (!professionalId || !branchId) return;
    const ranges = week.flatMap((dayRanges, weekday) =>
      dayRanges.map((range) => ({ weekday, startTime: range.startTime, endTime: range.endTime })),
    );
    startSaving(async () => {
      const result = await saveWorkingHoursAction({ professionalId, branchId, ranges });
      if (result.ok) {
        const name = formData.professionals.find((p) => p.id === professionalId)?.name ?? "profissional";
        toast.success(`Disponibilidade de ${name} atualizada`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  // ── Bloqueios ───────────────────────────────────────────────────────────
  const [blockDay, setBlockDay] = useState("");
  const [blockStart, setBlockStart] = useState("09:00");
  const [blockEnd, setBlockEnd] = useState("12:00");
  const [blockReason, setBlockReason] = useState("");

  const blocks = allBlocks.filter((b) => b.professionalId === professionalId);

  function addBlock() {
    if (!professionalId || !blockDay) return;
    startBlocking(async () => {
      const result = await createBlockAction({
        professionalId,
        branchId,
        startsAt: localDateTimeToUtc(blockDay, blockStart, timezone).toISOString(),
        endsAt: localDateTimeToUtc(blockDay, blockEnd, timezone).toISOString(),
        reason: blockReason.trim() || null,
      });
      if (result.ok) {
        toast.success("Bloqueio criado");
        setBlockDay("");
        setBlockReason("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function removeBlock(blockId: number) {
    startBlocking(async () => {
      const result = await removeBlockAction({ blockId });
      if (result.ok) {
        toast.success("Bloqueio removido");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <SheetContent
      title="Disponibilidade"
        description="Os horários daqui alimentam a agenda, o link público e o agente de IA."
        footer={
          <>
            <Button variant="ghost" size="md" onClick={onClose}>
              Fechar
            </Button>
            <Button
              variant="primary"
              size="md"
              disabled={!professionalId || !branchId || hasError}
              loading={saving}
              onClick={save}
            >
              <Check />
              Salvar jornada
            </Button>
          </>
        }
      >
        <div className="space-y-5 px-5 py-4">
          <Field label="Profissional" htmlFor="disp-profissional">
            <Select
              id="disp-profissional"
              value={professionalId ?? ""}
              onChange={(e) => onProfessionalChange(e.target.value ? Number(e.target.value) : null)}
            >
              {formData.professionals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>

          {formData.branches.length > 1 ? (
            <Field
              label="Unidade"
              htmlFor="disp-unidade"
              hint="A jornada é por unidade: dá para atender de manhã numa e à tarde na outra."
            >
              <Select
                id="disp-unidade"
                value={branchId ?? ""}
                onChange={(e) => onBranchChange(e.target.value ? Number(e.target.value) : null)}
              >
                {formData.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          <section aria-labelledby="jornada">
            <span id="jornada" className="mb-1.5 block text-label text-ink">
              Jornada semanal
            </span>
            <ul className="divide-y divide-line rounded-card border border-line">
              {WEEKDAYS.map((weekday) => {
                const ranges = week[weekday];
                const error = errors[weekday];
                return (
                  <li key={weekday} className="px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-label text-ink">{WEEKDAY_LABEL[weekday]}</span>
                      <div className="flex items-center gap-0.5">
                        {ranges.length > 0 && workingDays > 1 ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-9"
                            onClick={() => copyToOtherWorkingDays(weekday)}
                            aria-label={`Copiar ${describeDay(ranges)} para os outros dias em que atende`}
                            title="Copiar para os outros dias em que atende"
                          >
                            <Copy />
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => addRange(weekday)}
                          aria-label={`Adicionar período em ${WEEKDAY_LABEL[weekday]}`}
                        >
                          <Plus />
                          Período
                        </Button>
                      </div>
                    </div>

                    {ranges.length === 0 ? (
                      <p className="text-caption text-ink-tertiary">
                        {elsewhere[weekday].length > 0
                          ? `Não atende aqui — atende em ${elsewhere[weekday].join(", ")}`
                          : "Não atende"}
                      </p>
                    ) : (
                      ranges.map((range, index) => (
                        <div key={index} className="mt-1.5 flex items-center gap-1.5">
                          <Input
                            type="time"
                            value={range.startTime}
                            aria-label={`Início do período ${index + 1} de ${WEEKDAY_LABEL[weekday]}`}
                            className="w-[112px] tabular"
                            onChange={(e) =>
                              updateDay(
                                weekday,
                                ranges.map((r, i) => (i === index ? { ...r, startTime: e.target.value } : r)),
                              )
                            }
                          />
                          <span className="text-caption text-ink-tertiary">até</span>
                          <Input
                            type="time"
                            value={range.endTime}
                            aria-label={`Fim do período ${index + 1} de ${WEEKDAY_LABEL[weekday]}`}
                            className="w-[112px] tabular"
                            onChange={(e) =>
                              updateDay(
                                weekday,
                                ranges.map((r, i) => (i === index ? { ...r, endTime: e.target.value } : r)),
                              )
                            }
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="ml-auto size-9"
                            aria-label={`Remover período ${index + 1} de ${WEEKDAY_LABEL[weekday]}`}
                            onClick={() => updateDay(weekday, ranges.filter((_, i) => i !== index))}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      ))
                    )}

                    {error ? (
                      <p role="alert" className="mt-1.5 text-caption text-danger">
                        {error}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <p className="mt-1.5 text-caption text-ink-tertiary">
              Salvar substitui a jornada deste profissional nesta unidade. Atendimentos já marcados
              continuam onde estão.
            </p>
          </section>

          <section aria-labelledby="bloqueios">
            <span id="bloqueios" className="mb-1.5 block text-label text-ink">
              Bloqueios
            </span>

            {blocks.length > 0 ? (
              <ul className="mb-2 divide-y divide-line rounded-card border border-line">
                {blocks.map((block) => (
                  <li key={block.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block text-label text-ink">
                        {formatTz(new Date(block.startsAt), timezone, "dd/MM")} ·{" "}
                        <span className="tabular">
                          {formatTz(new Date(block.startsAt), timezone, "HH:mm")}–
                          {formatTz(new Date(block.endsAt), timezone, "HH:mm")}
                        </span>
                      </span>
                      {block.reason ? (
                        <span className="block truncate text-caption text-ink-secondary">{block.reason}</span>
                      ) : null}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9"
                      aria-label="Remover bloqueio"
                      loading={blocking}
                      onClick={() => removeBlock(block.id)}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-2 text-caption text-ink-tertiary">
                Nenhuma folga ou compromisso marcado daqui para a frente.
              </p>
            )}

            <div className="space-y-2 rounded-card border border-line p-3">
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Dia" htmlFor="bloqueio-dia">
                  <Input
                    id="bloqueio-dia"
                    type="date"
                    value={blockDay}
                    onChange={(e) => setBlockDay(e.target.value)}
                    className="w-[150px]"
                  />
                </Field>
                <Field label="Das" htmlFor="bloqueio-inicio">
                  <Input
                    id="bloqueio-inicio"
                    type="time"
                    value={blockStart}
                    onChange={(e) => setBlockStart(e.target.value)}
                    className="w-[112px] tabular"
                  />
                </Field>
                <Field label="Às" htmlFor="bloqueio-fim">
                  <Input
                    id="bloqueio-fim"
                    type="time"
                    value={blockEnd}
                    onChange={(e) => setBlockEnd(e.target.value)}
                    className="w-[112px] tabular"
                  />
                </Field>
              </div>
              <Field label="Motivo" htmlFor="bloqueio-motivo" optional>
                <Input
                  id="bloqueio-motivo"
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  placeholder="Consulta, curso, folga…"
                />
              </Field>
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                disabled={!professionalId || !blockDay}
                loading={blocking}
                onClick={addBlock}
              >
                Bloquear período
              </Button>
              <p className="text-caption text-ink-tertiary">
                O bloqueio some da grade de horários livres, mas não cancela o que já estiver marcado.
              </p>
            </div>
          </section>
      </div>
    </SheetContent>
  );
}
