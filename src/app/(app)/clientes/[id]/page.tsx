import { ArrowLeft, MessageCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageBody, PageHeader, SectionLabel } from "@/components/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, DataRow } from "@/components/ui/card";
import { Metric, MetricRow } from "@/components/ui/metric";
import { formatBRL } from "@/lib/money";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { formatTz, formatTzCapitalized } from "@/lib/tz";
import { requireSession } from "@/server/auth";
import {
  getCustomer,
  getCustomerAppointments,
  getCustomerFormOptions,
  getCustomerPayments,
} from "@/server/services/customer-service";
import { CustomerActions } from "./customer-actions";
import { CustomerTabs } from "./customer-tabs";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  manual: "Cadastro manual",
  whatsapp: "WhatsApp",
  public_booking: "Agendamento online",
  ai: "Atendimento da IA",
  import: "Importação",
};

const METHOD_LABEL: Record<string, string> = {
  pix: "PIX",
  cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito",
  dinheiro: "Dinheiro",
  transferencia: "Transferência",
  outro: "Outro meio",
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireSession();
  const profile = await getCustomer(ctx, Number((await params).id));
  return { title: profile ? profile.customer.name : "Cliente" };
}

function ageFrom(birthdate: string | null): number | null {
  if (!birthdate) return null;
  const born = new Date(`${birthdate}T12:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - born.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < born.getUTCDate())) age -= 1;
  return age;
}

/** Dias até o próximo aniversário — vira sinal de relacionamento quando está perto. */
function daysToBirthday(birthdate: string | null): number | null {
  if (!birthdate) return null;
  const born = new Date(`${birthdate}T12:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), born.getUTCMonth(), born.getUTCDate(), 12));
  if (next.getTime() < now.getTime()) next.setUTCFullYear(next.getUTCFullYear() + 1);
  return Math.round((next.getTime() - now.getTime()) / 86_400_000);
}

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireSession();
  const id = Number((await params).id);
  if (!Number.isFinite(id)) notFound();

  const profile = await getCustomer(ctx, id);
  // Registro de outro tenant se comporta como inexistente, nunca como proibido
  if (!profile) notFound();

  const [{ upcoming, past }, paymentRows, formOptions] = await Promise.all([
    getCustomerAppointments(ctx, id),
    getCustomerPayments(ctx, id),
    getCustomerFormOptions(ctx),
  ]);

  const { customer, tags, ticketAverageCents } = profile;
  const age = ageFrom(customer.birthdate);
  const birthdayIn = daysToBirthday(customer.birthdate);
  const totalPaidCents = paymentRows.reduce((sum, p) => sum + p.amountCents, 0);
  const openCents = past
    .filter((a) => a.status === "completed")
    .reduce((sum, a) => sum + Math.max(0, a.priceCents - a.paidCents), 0);

  const preferredProfessional = formOptions.professionals.find(
    (p) => p.id === customer.preferredProfessionalId,
  );
  const preferredBranch = formOptions.branches.find((b) => b.id === customer.preferredBranchId);

  const mapAppointment = (a: (typeof upcoming)[number]) => ({
    id: a.id,
    startsAtLabel: formatTz(a.startsAt, ctx.timezone, "d MMM yyyy"),
    timeLabel: `${formatTz(a.startsAt, ctx.timezone, "HH:mm")}–${formatTz(a.endsAt, ctx.timezone, "HH:mm")}`,
    status: a.status,
    priceCents: a.priceCents,
    paidCents: a.paidCents,
    serviceName: a.serviceName,
    professionalName: a.professionalName,
    professionalColor: a.professionalColor,
    branchName: a.branchName,
  });

  const whatsappHref = customer.phone
    ? `https://wa.me/55${normalizePhone(customer.phone)}`
    : null;

  return (
    <div>
      <PageHeader
        entity
        title={customer.name}
        description={[
          customer.phone ? formatPhone(customer.phone) : null,
          customer.firstVisitAt
            ? `cliente desde ${formatTz(customer.firstVisitAt, ctx.timezone, "MMM yyyy")}`
            : SOURCE_LABEL[customer.source],
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <CustomerActions
            customer={{
              id: customer.id,
              name: customer.name,
              phone: customer.phone ?? "",
              email: customer.email ?? "",
              birthdate: customer.birthdate ?? "",
              notes: customer.notes ?? "",
              preferredProfessionalId: customer.preferredProfessionalId,
              preferredBranchId: customer.preferredBranchId,
              consentMarketing: customer.consentMarketing,
            }}
            options={formOptions}
          />
        }
      />

      <PageBody>
        <Link
          href="/clientes"
          data-print="hide"
          className="mb-5 inline-flex items-center gap-1.5 text-caption text-ink-secondary transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-3.5" />
          Todos os clientes
        </Link>

        <div className="flex flex-col gap-8 lg:flex-row">
          {/* Coluna de leitura */}
          <div className="min-w-0 flex-1 space-y-8">
            <MetricRow>
              <Metric label="Atendimentos" value={String(customer.visitsCount)} />
              <Metric label="Total gasto" value={formatBRL(customer.totalSpentCents)} />
              <Metric
                label="Ticket médio"
                value={ticketAverageCents ? formatBRL(ticketAverageCents) : "—"}
              />
              <Metric
                label="Faltas"
                value={String(customer.noShowCount)}
                tone={customer.noShowCount > 0 ? "danger" : "neutral"}
                hint={
                  customer.cancellationsCount > 0
                    ? `${customer.cancellationsCount} cancelamento${customer.cancellationsCount === 1 ? "" : "s"}`
                    : undefined
                }
              />
            </MetricRow>

            {openCents > 0 ? (
              <Card className="border-attention/40 bg-attention-soft/50 px-4 py-3">
                <p className="text-label text-ink">
                  {formatBRL(openCents)} em aberto de atendimentos já concluídos.
                </p>
                <p className="mt-0.5 text-caption text-ink-secondary">
                  Registre o pagamento pela agenda para o financeiro fechar.
                </p>
              </Card>
            ) : null}

            {/* O bloco clínico: é o que a profissional lê antes de encostar na cliente */}
            <section>
              <SectionLabel>Antes de atender</SectionLabel>
              <Card className="mt-3 px-4 py-3.5">
                {customer.notes ? (
                  <p className="whitespace-pre-wrap text-body text-ink">{customer.notes}</p>
                ) : (
                  <p className="text-body text-ink-secondary">
                    Nada registrado. Alergias, gestação, uso de ácido e contraindicações entram aqui
                    e aparecem para quem for atender.
                  </p>
                )}
              </Card>
            </section>

            <CustomerTabs
              upcoming={upcoming.map(mapAppointment)}
              past={past.map(mapAppointment)}
              paymentsList={paymentRows.map((p) => ({
                id: p.id,
                dateLabel: formatTz(p.paidAt, ctx.timezone, "d MMM yyyy"),
                amountCents: p.amountCents,
                methodLabel: METHOD_LABEL[p.method] ?? p.method,
                serviceName: p.serviceName,
              }))}
              totalPaidCents={totalPaidCents}
            />
          </div>

          {/* Trilho de contexto */}
          <aside className="w-full shrink-0 space-y-5 lg:w-[var(--rail-width)]">
            <Card className="px-4 py-4">
              <div className="flex items-center gap-3">
                <Avatar name={customer.name} size="lg" />
                <div className="min-w-0">
                  <p className="truncate text-card text-ink">{customer.name}</p>
                  <p className="text-caption text-ink-secondary">
                    {SOURCE_LABEL[customer.source] ?? customer.source}
                  </p>
                </div>
              </div>

              {tags.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <Badge key={tag} tone={tag === "VIP" ? "accent" : "neutral"}>
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : null}

              <dl className="mt-4 border-t border-line pt-2">
                {customer.phone ? (
                  <DataRow label="Celular">{formatPhone(customer.phone)}</DataRow>
                ) : null}
                {customer.email ? (
                  <DataRow label="E-mail">
                    <span className="break-all">{customer.email}</span>
                  </DataRow>
                ) : null}
                {customer.birthdate ? (
                  <DataRow label="Nascimento">
                    {formatTz(new Date(`${customer.birthdate}T12:00:00Z`), ctx.timezone, "d MMM yyyy")}
                    {age !== null ? ` · ${age} anos` : ""}
                  </DataRow>
                ) : null}
                <DataRow label="Última visita">
                  {customer.lastVisitAt
                    ? formatTz(customer.lastVisitAt, ctx.timezone, "d MMM yyyy")
                    : "Ainda não veio"}
                </DataRow>
              </dl>

              {birthdayIn !== null && birthdayIn <= 30 ? (
                <p className="mt-3 rounded-control bg-accent-soft px-2.5 py-1.5 text-caption text-accent">
                  {birthdayIn === 0 ? "Faz aniversário hoje" : `Aniversário em ${birthdayIn} dias`}
                </p>
              ) : null}

              {whatsappHref ? (
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noreferrer"
                  data-print="hide"
                  className="mt-4 flex h-9 items-center justify-center gap-2 rounded-control border border-line-strong bg-surface-raised text-label text-ink transition-colors hover:bg-surface-sunken"
                >
                  <MessageCircle className="size-4 text-ink-tertiary" />
                  Abrir conversa no WhatsApp
                </a>
              ) : null}
            </Card>

            <Card className="px-4 py-3.5">
              <h3 className="text-card text-ink">Preferências</h3>
              <dl className="mt-2">
                <DataRow label="Profissional">
                  {preferredProfessional?.name ?? <span className="text-ink-tertiary">Sem preferência</span>}
                </DataRow>
                <DataRow label="Unidade">
                  {preferredBranch?.name ?? <span className="text-ink-tertiary">Sem preferência</span>}
                </DataRow>
                <DataRow label="Divulgação">
                  {customer.consentMarketing ? "Autorizada" : "Não autorizada"}
                </DataRow>
              </dl>
            </Card>
          </aside>
        </div>
      </PageBody>
    </div>
  );
}
