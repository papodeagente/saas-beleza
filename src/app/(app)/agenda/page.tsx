import { addDays, endOfMonth, endOfWeek, startOfMonth, startOfWeek } from "date-fns";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { userAgent } from "next/server";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { requireSession } from "@/server/auth";
import { getAgendaDay, getAgendaFormData, getAgendaRange } from "@/server/services/agenda-service";
import { getScheduleSettings } from "@/server/services/schedule-settings-service";
import { dateISOInTz, dayRangeInTz } from "@/lib/tz";
import { AgendaView } from "./agenda-view";

export const metadata = { title: "Agenda" };
export const dynamic = "force-dynamic";

/**
 * Visão padrão da agenda quando a URL não pede uma.
 *
 * Semana é o padrão certo no desktop e inutilizável no celular: são sete
 * colunas em 390px, cada uma com ~50px úteis, onde todo nome vira "Re…". A
 * decisão precisa ser tomada no SERVIDOR e não no cliente porque ela muda a
 * consulta — a visão de dia nem chega a pedir o intervalo da semana — e porque
 * decidir depois da hidratação faria a tela abrir errada e se remontar.
 *
 * `sec-ch-ua-mobile` vem primeiro por ser um sinal declarado pelo próprio
 * navegador (Chromium manda em toda requisição); a leitura do user-agent é o
 * plano B para Safari e Firefox, que não enviam a dica.
 */
async function defaultViewMode(): Promise<"dia" | "semana"> {
  const cabecalhos = await headers();
  const dica = cabecalhos.get("sec-ch-ua-mobile");
  if (dica === "?1") return "dia";
  if (dica === "?0") return "semana";
  return userAgent({ headers: cabecalhos }).device.type === "mobile" ? "dia" : "semana";
}

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
    visualizacao?: "dia" | "semana" | "mes";
  }>;
}) {
  const ctx = await requireSession();
  const params = await searchParams;
  const day = resolveDay(params.dia);
  const viewMode =
    params.visualizacao === "dia" || params.visualizacao === "mes" || params.visualizacao === "semana"
      ? params.visualizacao
      : await defaultViewMode();
  const branchId = params.unidade ? Number(params.unidade) : undefined;
  const rangeStart = viewMode === "mes"
    ? startOfWeek(startOfMonth(day), { weekStartsOn: 1 })
    : viewMode === "semana"
      ? startOfWeek(day, { weekStartsOn: 1 })
      : day;
  const rangeEnd = viewMode === "mes"
    ? endOfWeek(endOfMonth(day), { weekStartsOn: 1 })
    : viewMode === "semana"
      ? endOfWeek(day, { weekStartsOn: 1 })
      : day;

  const customerId = params.cliente ? Number(params.cliente) : null;

  const [agenda, rangeAppointments, formData, schedule, presetCustomer] = await Promise.all([
    getAgendaDay(ctx, day, branchId),
    viewMode === "dia" ? Promise.resolve([]) : getAgendaRange(ctx, rangeStart, rangeEnd, branchId),
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
      viewMode={viewMode}
      rangeStartISO={dateISOInTz(dayRangeInTz(rangeStart, ctx.timezone).start, ctx.timezone)}
      rangeEndISO={dateISOInTz(dayRangeInTz(rangeEnd, ctx.timezone).start, ctx.timezone)}
      rangeAppointments={rangeAppointments.map((a) => ({
        ...a,
        startsAt: a.startsAt.toISOString(),
        endsAt: a.endsAt.toISOString(),
      }))}
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
