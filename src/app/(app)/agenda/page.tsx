import { addDays } from "date-fns";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { requireSession } from "@/server/auth";
import { getAgendaDay, getAgendaFormData } from "@/server/services/agenda-service";
import { getScheduleSettings } from "@/server/services/schedule-settings-service";
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
  searchParams: Promise<{
    dia?: string;
    unidade?: string;
    atendimento?: string;
    /** Abre o painel de novo atendimento — usado pelo inbox e pela ficha do cliente. */
    novo?: string;
    cliente?: string;
  }>;
}) {
  const ctx = await requireSession();
  const params = await searchParams;
  const day = resolveDay(params.dia);
  const branchId = params.unidade ? Number(params.unidade) : undefined;

  const customerId = params.cliente ? Number(params.cliente) : null;

  const [agenda, formData, schedule, presetCustomer] = await Promise.all([
    getAgendaDay(ctx, day, branchId),
    getAgendaFormData(ctx),
    getScheduleSettings(ctx),
    // Cliente vindo do inbox: já entra escolhido no painel, sem busca de novo.
    customerId
      ? db
          .select({ id: customers.id, name: customers.name, phone: customers.phone })
          .from(customers)
          .where(and(eq(customers.id, customerId), eq(customers.organizationId, ctx.organizationId)))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);

  const { start: dayStartUtc } = dayRangeInTz(day, ctx.timezone);

  const dateISO = dateISOInTz(dayStartUtc, ctx.timezone);
  const openAppointmentId = params.atendimento ? Number(params.atendimento) : null;

  return (
    <AgendaView
      // Dia e atendimento aberto vêm da URL: a chave remonta a view em vez de
      // sincronizar estado com prop dentro de um efeito.
      key={`${dateISO}:${openAppointmentId ?? ""}:${customerId ?? ""}`}
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
      schedule={{
        hours: schedule.hours,
        blocks: schedule.blocks.map((block) => ({
          ...block,
          startsAt: block.startsAt.toISOString(),
          endsAt: block.endsAt.toISOString(),
        })),
      }}
      canManageSchedule={ctx.role === "owner" || ctx.role === "admin"}
      selectedBranchId={branchId ?? null}
      openAppointmentId={openAppointmentId}
      openNew={params.novo === "1" || Boolean(customerId)}
      presetCustomer={presetCustomer}
    />
  );
}
