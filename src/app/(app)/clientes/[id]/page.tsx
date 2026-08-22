import { ArrowLeft, CalendarCheck, Receipt } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SectionLabel } from "@/components/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { STATUS_LABEL, STATUS_TONE, type AppointmentStatus } from "@/domain/appointment-status";
import { formatBRL } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { formatTz, formatTzCapitalized } from "@/lib/tz";
import { requireSession } from "@/server/auth";
import { getCustomer, getCustomerTimeline } from "@/server/services/customer-service";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  manual: "Cadastro manual",
  whatsapp: "WhatsApp",
  public_booking: "Agendamento online",
  ai: "Atendimento da IA",
  import: "Importação",
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireSession();
  const profile = await getCustomer(ctx, Number((await params).id));
  return { title: profile ? `${profile.customer.name} — Lumina` : "Cliente — Lumina" };
}

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireSession();
  const id = Number((await params).id);
  if (!Number.isFinite(id)) notFound();

  const profile = await getCustomer(ctx, id);
  // Registro de outro tenant se comporta como inexistente, nunca como proibido
  if (!profile) notFound();

  const timeline = await getCustomerTimeline(ctx, id);
  const { customer, tags, nextAppointment, ticketAverageCents } = profile;

  // Agrupa a timeline por dia — a recepção lê o histórico por data, não por item
  const days = timeline.reduce((map, entry) => {
    const key = formatTz(entry.at, ctx.timezone, "yyyy-MM-dd");
    const list = map.get(key) ?? [];
    list.push(entry);
    map.set(key, list);
    return map;
  }, new Map<string, typeof timeline>());

  return (
    <div className="mx-auto max-w-[820px] px-5 py-6 md:px-8 md:py-8">
      <Link
        href="/clientes"
        className="inline-flex items-center gap-1.5 text-[12px] text-ink-tertiary transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        Clientes
      </Link>

      {/* Identidade + os números que importam */}
      <header className="mt-4 flex flex-wrap items-start gap-4">
        <Avatar name={customer.name} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[19px] font-semibold leading-6 tracking-[-0.01em] text-ink">
              {customer.name}
            </h1>
            {tags.map((tag) => (
              <Badge key={tag} tone={tag === "VIP" ? "accent" : "neutral"}>
                {tag}
              </Badge>
            ))}
          </div>
          <p className="mt-1 text-[13px] text-ink-secondary">
            {customer.phone ? formatPhone(customer.phone) : "Sem telefone"}
            {customer.email ? ` · ${customer.email}` : ""}
          </p>
          <p className="mt-0.5 text-[12px] text-ink-tertiary">
            Origem: {SOURCE_LABEL[customer.source] ?? customer.source}
            {customer.firstVisitAt
              ? ` · Cliente desde ${formatTz(customer.firstVisitAt, ctx.timezone, "MMM yyyy")}`
              : ""}
          </p>
        </div>
        <Button variant="primary" size="md" asChild>
          <Link href="/agenda">Agendar</Link>
        </Button>
      </header>

      <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius)] border border-line bg-line sm:grid-cols-4">
        <Metric label="Atendimentos" value={String(customer.visitsCount)} />
        <Metric label="Total gasto" value={formatBRL(customer.totalSpentCents)} />
        <Metric label="Ticket médio" value={ticketAverageCents ? formatBRL(ticketAverageCents) : "—"} />
        <Metric
          label="Faltas"
          value={String(customer.noShowCount)}
          tone={customer.noShowCount > 0 ? "danger" : undefined}
        />
      </div>

      {nextAppointment ? (
        <div className="mt-4 flex items-center gap-3 rounded-[var(--radius)] border border-line bg-positive-soft/60 px-4 py-3">
          <CalendarCheck className="size-4 shrink-0 text-positive" />
          <p className="text-[13px] text-ink">
            <span className="font-medium">Próximo atendimento</span> ·{" "}
            {formatTzCapitalized(nextAppointment.startsAt, ctx.timezone, "EEEE, d 'de' MMMM 'às' HH:mm")} ·{" "}
            {nextAppointment.serviceName} com {nextAppointment.professionalName.split(" ")[0]}
          </p>
        </div>
      ) : null}

      {/* Timeline única do relacionamento */}
      <section className="mt-8">
        <SectionLabel>Histórico</SectionLabel>

        {timeline.length === 0 ? (
          <div className="mt-3 rounded-[var(--radius)] border border-line bg-surface-raised">
            <EmptyState
              icon={Receipt}
              title="Ainda sem histórico"
              description="Quando esse cliente for atendido, tudo o que acontecer aparece aqui em ordem."
              action={
                <Button variant="secondary" size="md" asChild>
                  <Link href="/agenda">Marcar primeiro atendimento</Link>
                </Button>
              }
            />
          </div>
        ) : (
          <div className="mt-3 space-y-5">
            {[...days.entries()].map(([day, entries]) => (
              <div key={day}>
                <p className="mb-2 text-[12px] font-medium text-ink-tertiary">
                  {formatTzCapitalized(entries[0].at, ctx.timezone, "d 'de' MMMM 'de' yyyy")}
                </p>
                <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius)] border border-line bg-surface-raised">
                  {entries.map((entry) => (
                    <li key={entry.id} className="flex items-center gap-3 px-4 py-2.5">
                      <time
                        dateTime={entry.at.toISOString()}
                        className="w-11 shrink-0 text-[12px] tabular text-ink-tertiary"
                      >
                        {formatTz(entry.at, ctx.timezone, "HH:mm")}
                      </time>
                      <span
                        aria-hidden
                        className={`size-1.5 shrink-0 rounded-full ${
                          entry.kind === "payment" ? "bg-positive" : "bg-line-strong"
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-ink">{entry.title}</span>
                        <span className="block truncate text-[12px] text-ink-tertiary">{entry.detail}</span>
                      </span>
                      {entry.status ? (
                        <Badge tone={STATUS_TONE[entry.status as keyof typeof STATUS_TONE]}>
                          {STATUS_LABEL[entry.status as AppointmentStatus]}
                        </Badge>
                      ) : null}
                      {entry.amountCents !== undefined ? (
                        <span
                          className={`w-[86px] shrink-0 text-right text-[13px] tabular ${
                            entry.kind === "payment" ? "text-positive" : "text-ink-secondary"
                          }`}
                        >
                          {entry.kind === "payment" ? "+" : ""}
                          {formatBRL(entry.amountCents)}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="bg-surface-raised px-4 py-3">
      <p className="text-[12px] text-ink-tertiary">{label}</p>
      <p
        className={`mt-0.5 text-[17px] font-semibold leading-6 tabular ${
          tone === "danger" ? "text-danger" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
