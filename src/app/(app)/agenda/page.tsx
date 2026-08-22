import { addDays } from "date-fns";
import { requireSession } from "@/server/auth";
import { getAgendaDay, getAgendaFormData } from "@/server/services/agenda-service";
import { dateISOInTz, dayRangeInTz } from "@/lib/tz";
import { AgendaView } from "./agenda-view";

export const metadata = { title: "Agenda — Lumina" };
export const dynamic = "force-dynamic";

function resolveDay(param: string | undefined): Date {
  const today = new Date();
  if (!param || param === "hoje") return today;
  if (param === "amanha") return addDays(today, 1);
  if (param === "ontem") return addDays(today, -1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(param)) return new Date(`${param}T12:00:00Z`);
  return today;
}

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ dia?: string; unidade?: string; atendimento?: string }>;
}) {
  const ctx = await requireSession();
  const params = await searchParams;
  const day = resolveDay(params.dia);
  const branchId = params.unidade ? Number(params.unidade) : undefined;

  const [agenda, formData] = await Promise.all([
    getAgendaDay(ctx, day, branchId),
    getAgendaFormData(ctx),
  ]);

  const { start: dayStartUtc } = dayRangeInTz(day, ctx.timezone);

  const dateISO = dateISOInTz(dayStartUtc, ctx.timezone);
  const openAppointmentId = params.atendimento ? Number(params.atendimento) : null;

  return (
    <AgendaView
      // Dia e atendimento aberto vêm da URL: a chave remonta a view em vez de
      // sincronizar estado com prop dentro de um efeito.
      key={`${dateISO}:${openAppointmentId ?? ""}`}
      dateISO={dateISO}
      dayStartUtcISO={dayStartUtc.toISOString()}
      timezone={ctx.timezone}
      isToday={dateISO === dateISOInTz(new Date(), ctx.timezone)}
      agenda={{
        ...agenda,
        appointments: agenda.appointments.map((a) => ({
          ...a,
          startsAt: a.startsAt.toISOString(),
          endsAt: a.endsAt.toISOString(),
        })),
      }}
      formData={formData}
      selectedBranchId={branchId ?? null}
      openAppointmentId={openAppointmentId}
    />
  );
}
