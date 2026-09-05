import { addDays, format } from "date-fns";
import { redirect } from "next/navigation";
import { BarChart3, CalendarRange, Info } from "lucide-react";
import { PageBody, PageHeader } from "@/components/app-shell";
import { FunnelChart } from "@/components/ui/funnel-chart";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { dateISOInTz } from "@/lib/tz";
import { requireSession } from "@/server/auth";
import { getBookingFunnel } from "@/server/services/booking-funnel-service";

export const metadata = { title: "Funil da agenda" };
export const dynamic = "force-dynamic";
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const ctx = await requireSession();
  if (ctx.role !== "owner" && ctx.role !== "admin") redirect("/hoje");
  const query = await searchParams;
  const today = dateISOInTz(new Date(), ctx.timezone);
  const defaultFrom = format(addDays(new Date(`${today}T12:00:00`), -29), "yyyy-MM-dd");
  const from = query.from && ISO.test(query.from) ? query.from : defaultFrom;
  const to = query.to && ISO.test(query.to) ? query.to : today;
  const safeFrom = from <= to ? from : to;
  const safeTo = from <= to ? to : from;
  const report = await getBookingFunnel(ctx, safeFrom, safeTo);
  const totalConversion = report.stages[0].value > 0
    ? (report.stages.at(-1)!.value / report.stages[0].value) * 100
    : 0;

  return (
    <div>
      <PageHeader title="Funil da agenda" description="Veja onde a jornada avança e em qual etapa as clientes se perdem." />
      <PageBody className="space-y-6">
        <Card className="p-4">
          <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex-1"><span className="mb-1.5 block text-label text-ink">De</span><Input type="date" name="from" defaultValue={safeFrom} max={safeTo} /></label>
            <label className="flex-1"><span className="mb-1.5 block text-label text-ink">Até</span><Input type="date" name="to" defaultValue={safeTo} min={safeFrom} max={today} /></label>
            <Button variant="primary" type="submit"><CalendarRange aria-hidden />Aplicar período</Button>
          </form>
        </Card>

        <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="Acessos registrados" value={report.stages[0].value} />
          <Metric label="Agendamentos públicos" value={report.stages[1].value} />
          <Metric label="Conversão até recorrência" value={`${totalConversion.toFixed(1).replace(".", ",")}%`} />
        </div>

        <Card className="overflow-hidden p-4 sm:p-6">
          <div className="mb-6 flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-pill bg-accent-soft text-accent"><BarChart3 className="size-5" aria-hidden /></span>
            <div><h2 className="text-card text-ink">Jornada da cliente</h2><p className="mt-0.5 text-caption text-ink-secondary">Coorte de agendamentos criados entre {formatDate(safeFrom)} e {formatDate(safeTo)}.</p></div>
          </div>
          <FunnelChart stages={report.stages} />
        </Card>

        <Card inset className="p-4">
          <div className="flex items-start gap-2"><Info className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden /><div className="text-caption text-ink-secondary">
            <p className="font-semibold text-ink">Dados reais, sem projeção</p>
            <p className="mt-1">Acesso é um navegador único por dia no link público. Agendamento considera somente origem pública. Confirmação, comparecimento e fechamento exigem os eventos registrados <em>Confirmado</em>, <em>Check-in</em> e <em>Concluído</em>. Recorrência é um fechamento de cliente que já possuía outro atendimento concluído anteriormente.</p>
            <p className="mt-1">{report.accessTrackingSince ? `Os acessos são medidos desde ${formatDate(report.accessTrackingSince)}.` : "O rastreamento de acessos começa com esta atualização; períodos anteriores permanecerão zerados nessa etapa."}</p>
          </div></div>
        </Card>
      </PageBody>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <Card className="px-4 py-4"><p className="text-caption text-ink-secondary">{label}</p><p className="mt-1 text-title tabular text-ink">{typeof value === "number" ? value.toLocaleString("pt-BR") : value}</p></Card>;
}

function formatDate(iso: string) {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}
