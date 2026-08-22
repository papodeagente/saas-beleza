import { ArrowRight, CalendarPlus } from "lucide-react";
import Link from "next/link";
import { SectionLabel } from "@/components/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatBRL, formatBRLCompact } from "@/lib/money";
import { formatTz, formatTzCapitalized } from "@/lib/tz";
import { requireSession } from "@/server/auth";
import { STATUS_LABEL, STATUS_TONE, type AppointmentStatus } from "@/domain/appointment-status";
import {
  getAttentionItems,
  getReturnDueCount,
  getTodayAppointments,
  summarize,
} from "@/server/services/today-service";
import { cn } from "@/lib/utils";

export const metadata = { title: "Hoje — Lumina" };
export const dynamic = "force-dynamic";

function greeting(hour: number): string {
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

export default async function TodayPage() {
  const ctx = await requireSession();
  const appointments = await getTodayAppointments(ctx);
  const summary = summarize(appointments);
  const [attention, returnDue] = await Promise.all([
    getAttentionItems(ctx, appointments),
    getReturnDueCount(ctx),
  ]);

  const now = new Date();
  const hour = Number(formatTz(now, ctx.timezone, "H"));
  const firstName = ctx.userName.split(" ")[0];
  const upcoming = appointments.filter((a) => a.endsAt >= now && a.status !== "cancelled" && a.status !== "no_show");
  const nextUp = upcoming.slice(0, 6);

  return (
    <div className="mx-auto max-w-[880px] px-5 py-8 md:px-8 md:py-10">
      <header>
        <p className="text-[12px] text-ink-tertiary">
          {formatTzCapitalized(now, ctx.timezone, "EEEE, d 'de' MMMM")}
        </p>
        <h1 className="mt-1 font-display text-[28px] leading-9 text-ink">
          {greeting(hour)}, {firstName}
        </h1>
      </header>

      {/* Briefing do dia — a resposta de 3 segundos */}
      <section className="mt-7" aria-labelledby="resumo-hoje">
        <h2 id="resumo-hoje" className="sr-only">
          Resumo de hoje
        </h2>
        {summary.total === 0 ? (
          <div className="rounded-[var(--radius)] border border-line bg-surface-raised">
            <EmptyState
              title="Nenhum atendimento hoje"
              description="Sua agenda está livre. Um bom momento para chamar clientes que estão no período de retorno."
              action={
                <Button variant="primary" size="md" asChild>
                  <Link href="/agenda">Abrir agenda</Link>
                </Button>
              }
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius)] border border-line bg-line sm:grid-cols-4">
            <Metric label="Atendimentos" value={String(summary.total)} />
            <Metric label="Receita prevista" value={formatBRLCompact(summary.expectedRevenueCents)} />
            <Metric
              label="Confirmados"
              value={`${summary.confirmed}`}
              hint={summary.awaitingConfirmation > 0 ? `${summary.awaitingConfirmation} aguardando` : undefined}
            />
            <Metric label="Já recebido" value={formatBRLCompact(summary.receivedCents)} />
          </div>
        )}
      </section>

      {/* Atenção — só o que tem ação */}
      {attention.length > 0 ? (
        <section className="mt-9" aria-labelledby="atencao">
          <SectionLabel>
            <span id="atencao">Precisa da sua atenção</span>
          </SectionLabel>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[var(--radius)] border border-line bg-surface-raised">
            {attention.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-sunken"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      item.tone === "danger" && "bg-danger",
                      item.tone === "attention" && "bg-attention",
                      item.tone === "info" && "bg-info",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-ink">{item.label}</span>
                    {item.detail ? (
                      <span className="mt-0.5 block truncate text-[12px] text-ink-tertiary">{item.detail}</span>
                    ) : null}
                  </span>
                  <span className="hidden shrink-0 items-center gap-1 text-[12px] text-ink-tertiary transition-colors group-hover:text-accent sm:flex">
                    {item.actionLabel}
                    <ArrowRight className="size-3.5" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Próximos atendimentos — timeline operacional */}
      <section className="mt-9" aria-labelledby="proximos">
        <div className="flex items-center justify-between">
          <SectionLabel>
            <span id="proximos">Próximos atendimentos</span>
          </SectionLabel>
          <Link
            href="/agenda"
            className="text-[12px] text-ink-tertiary transition-colors hover:text-accent"
          >
            Ver agenda
          </Link>
        </div>

        {nextUp.length === 0 ? (
          <div className="mt-3 rounded-[var(--radius)] border border-line bg-surface-raised">
            <EmptyState
              icon={CalendarPlus}
              title="O dia já está encerrado"
              description={
                summary.completed > 0
                  ? `${summary.completed} ${summary.completed === 1 ? "atendimento concluído" : "atendimentos concluídos"} hoje. Nada mais na fila.`
                  : "Não há mais atendimentos previstos para hoje."
              }
              action={
                <Button variant="secondary" size="md" asChild>
                  <Link href="/agenda">Abrir agenda</Link>
                </Button>
              }
            />
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[var(--radius)] border border-line bg-surface-raised">
            {nextUp.map((appointment) => (
              <li key={appointment.id}>
                <Link
                  href={`/agenda?atendimento=${appointment.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-sunken"
                >
                  <time
                    dateTime={appointment.startsAt.toISOString()}
                    className="w-11 shrink-0 text-[13px] font-medium text-ink"
                  >
                    {formatTz(appointment.startsAt, ctx.timezone, "HH:mm")}
                  </time>
                  <Avatar name={appointment.customerName} size="sm" color={appointment.professionalColor} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">{appointment.customerName}</span>
                    <span className="mt-0.5 block truncate text-[12px] text-ink-tertiary">
                      {appointment.serviceName} · {appointment.professionalName.split(" ")[0]}
                    </span>
                  </span>
                  <span className="hidden text-[13px] text-ink-secondary sm:block">
                    {formatBRL(appointment.priceCents)}
                  </span>
                  <Badge tone={STATUS_TONE[appointment.status as keyof typeof STATUS_TONE]}>
                    {STATUS_LABEL[appointment.status as AppointmentStatus]}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Inteligência — insight com ação, nunca métrica solta */}
      {returnDue > 0 ? (
        <section className="mt-9" aria-labelledby="inteligencia">
          <SectionLabel>
            <span id="inteligencia">Inteligência</span>
          </SectionLabel>
          <div className="mt-3 rounded-[var(--radius)] border border-line bg-surface-raised px-4 py-3.5">
            <p className="text-[13px] leading-5 text-ink">
              <strong className="font-semibold">{returnDue} clientes</strong> passaram do período ideal de
              retorno e ainda não voltaram.
            </p>
            <p className="mt-1 text-[12px] text-ink-tertiary">
              Retomar contato com quem já conhece a clínica costuma converter mais que atrair alguém novo.
            </p>
            <div className="mt-3">
              <Button variant="secondary" size="sm" asChild>
                <Link href="/clientes?filtro=retorno">Ver clientes</Link>
              </Button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-surface-raised px-4 py-3.5">
      <p className="text-[12px] text-ink-tertiary">{label}</p>
      <p className="mt-1 text-[22px] font-semibold leading-7 text-ink tabular">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-attention">{hint}</p> : null}
    </div>
  );
}
