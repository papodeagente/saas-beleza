/**
 * Hoje é a EXCEÇÃO declarada do sistema de design: é a única rota sem
 * PageHeader. Abre com data + saudação em `text-display` (Fraunces), que é a
 * voz do produto no único momento do dia em que ela cabe. E não repete a
 * palavra "Hoje" — o item ativo da barra lateral já responde "onde estou".
 */
import { ArrowRight, CalendarPlus } from "lucide-react";
import Link from "next/link";
import { PageBody, SectionLabel } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardList } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Metric, MetricRow } from "@/components/ui/metric";
import { ProfessionalDot, stripeColor } from "@/components/ui/status-stripe";
import { STATUS_LABEL, STATUS_TONE, type AppointmentStatus } from "@/domain/appointment-status";
import { formatBRL, formatBRLCompact } from "@/lib/money";
import { formatTz, formatTzCapitalized } from "@/lib/tz";
import { cn } from "@/lib/utils";
import { requireSession } from "@/server/auth";
import {
  getAttentionItems,
  getReturnDueCount,
  getTodayAppointments,
  summarize,
} from "@/server/services/today-service";

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
  const upcoming = appointments.filter(
    (a) => a.endsAt >= now && a.status !== "cancelled" && a.status !== "no_show",
  );
  const nextUp = upcoming.slice(0, 6);

  // A unidade só entra na linha de apoio quando existe mais de uma no dia:
  // o que pode ser inferido não ocupa espaço.
  const showBranch = new Set(appointments.map((a) => a.branchName)).size > 1;

  return (
    <PageBody>
      <header>
        <p className="text-caption text-ink-secondary">
          {formatTzCapitalized(now, ctx.timezone, "EEEE, d 'de' MMMM")}
        </p>
        <h1 className="mt-1 text-display text-ink">
          {greeting(hour)}, {firstName}
        </h1>
      </header>

      {/* Briefing do dia — a resposta de 3 segundos */}
      <section className="mt-6" aria-labelledby="resumo-hoje">
        <h2 id="resumo-hoje" className="sr-only">
          Resumo do dia
        </h2>
        {summary.total === 0 ? (
          <Card>
            <EmptyState
              title="Nenhum atendimento hoje"
              description="Sua agenda está livre. Um bom momento para retomar contato com quem já passou do período de retorno."
              action={
                <Button variant="primary" size="md" asChild>
                  <Link href="/agenda">Abrir agenda</Link>
                </Button>
              }
            />
          </Card>
        ) : (
          <MetricRow>
            <Metric label="Atendimentos" value={String(summary.total)} />
            <Metric label="Receita prevista" value={formatBRLCompact(summary.expectedRevenueCents)} />
            <Metric
              label="Confirmados"
              value={String(summary.confirmed)}
              hint={
                summary.awaitingConfirmation > 0
                  ? `${summary.awaitingConfirmation} sem confirmação registrada`
                  : undefined
              }
            />
            <Metric label="Já recebido" value={formatBRLCompact(summary.receivedCents)} />
          </MetricRow>
        )}
      </section>

      {/* Atenção — só o que tem ação */}
      {attention.length > 0 ? (
        <section className="mt-8" aria-labelledby="atencao">
          <SectionLabel>
            <span id="atencao">Precisa da sua atenção</span>
          </SectionLabel>
          <Card className="mt-3">
            <CardList>
              {attention.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="group flex min-h-[56px] items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-sunken"
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
                      <span className="block text-body text-ink">{item.label}</span>
                      {item.detail ? (
                        <span className="mt-0.5 block truncate text-caption text-ink-secondary">
                          {item.detail}
                        </span>
                      ) : null}
                    </span>
                    <span className="hidden shrink-0 items-center gap-1 text-caption text-ink-secondary transition-colors group-hover:text-ink sm:flex">
                      {item.actionLabel}
                      <ArrowRight className="size-3.5 text-ink-tertiary" />
                    </span>
                  </Link>
                </li>
              ))}
            </CardList>
          </Card>
        </section>
      ) : null}

      {/* Próximos atendimentos — timeline operacional */}
      <section className="mt-8" aria-labelledby="proximos">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>
            <span id="proximos">Próximos atendimentos</span>
          </SectionLabel>
          <Link
            href="/agenda"
            className="-mr-2 flex min-h-[44px] items-center rounded-control px-2 text-caption text-ink-secondary transition-colors hover:text-ink md:min-h-0 md:py-1"
          >
            Ver agenda
          </Link>
        </div>

        {nextUp.length === 0 ? (
          <Card className="mt-3">
            <EmptyState
              size="sm"
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
          </Card>
        ) : (
          <Card className="mt-3">
            <CardList>
              {nextUp.map((appointment) => (
                <li key={appointment.id}>
                  <Link
                    href={`/agenda?atendimento=${appointment.id}`}
                    className="relative flex min-h-[56px] items-center gap-3 py-2.5 pl-5 pr-4 transition-colors hover:bg-surface-sunken"
                  >
                    {/* Faixa de 3px = status, o mesmo código em toda lista de atendimento */}
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 w-[3px]"
                      style={{ backgroundColor: stripeColor(appointment.status) }}
                    />
                    <time
                      dateTime={appointment.startsAt.toISOString()}
                      className="w-11 shrink-0 text-label text-ink-secondary"
                    >
                      {formatTz(appointment.startsAt, ctx.timezone, "HH:mm")}
                    </time>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-label text-ink">
                        {appointment.customerName}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-caption text-ink-secondary">
                        <span className="truncate">{appointment.serviceName}</span>
                        <span aria-hidden className="text-ink-tertiary">
                          ·
                        </span>
                        <ProfessionalDot color={appointment.professionalColor} />
                        <span className="truncate">{appointment.professionalName.split(" ")[0]}</span>
                        {showBranch ? (
                          <>
                            <span aria-hidden className="text-ink-tertiary">
                              ·
                            </span>
                            <span className="hidden truncate sm:inline">{appointment.branchName}</span>
                          </>
                        ) : null}
                      </span>
                    </span>
                    <span className="hidden shrink-0 text-label text-ink-secondary tabular sm:block">
                      {formatBRL(appointment.priceCents)}
                    </span>
                    <Badge tone={STATUS_TONE[appointment.status as keyof typeof STATUS_TONE]}>
                      {STATUS_LABEL[appointment.status as AppointmentStatus]}
                    </Badge>
                  </Link>
                </li>
              ))}
            </CardList>
          </Card>
        )}
      </section>

      {/* Retenção — insight com ação, nunca métrica solta */}
      {returnDue > 0 ? (
        <section className="mt-8" aria-labelledby="vale-olhar">
          <SectionLabel>
            <span id="vale-olhar">O que vale a pena olhar</span>
          </SectionLabel>
          <Card className="mt-3 px-4 py-3.5">
            <p className="text-body text-ink">
              <strong className="font-semibold tabular">{returnDue} clientes</strong> passaram do
              período ideal de retorno e ainda não voltaram.
            </p>
            <p className="mt-1 text-caption text-ink-secondary">
              Retomar contato com quem já conhece a clínica costuma converter mais do que atrair
              alguém novo.
            </p>
            <div className="mt-3">
              <Button variant="secondary" size="sm" asChild>
                <Link href="/clientes?filtro=retorno">Ver clientes</Link>
              </Button>
            </div>
          </Card>
        </section>
      ) : null}
    </PageBody>
  );
}
