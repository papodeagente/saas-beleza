import { ArrowLeft, Ban, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PlatformBody, PlatformHeader } from "@/components/platform-shell";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardList, DataRow } from "@/components/ui/card";
import { formatBRL } from "@/lib/money";
import { formatTz } from "@/lib/tz";
import { cn } from "@/lib/utils";
import { requirePlatformAdmin } from "@/server/platform-auth";
import { getAccount, listPlans } from "@/server/services/platform-accounts";
import { AccountActions } from "./account-actions";

export const dynamic = "force-dynamic";

const PLATFORM_TZ = "America/Sao_Paulo";

const STATUS: Record<string, { label: string; tone: "positive" | "attention" | "info" | "neutral" }> =
  {
    active: { label: "Ativa", tone: "positive" },
    past_due: { label: "Inadimplente", tone: "attention" },
    trialing: { label: "Em teste", tone: "info" },
    paused: { label: "Pausada", tone: "neutral" },
    canceled: { label: "Cancelada", tone: "neutral" },
  };

const CYCLE: Record<string, string> = { monthly: "Mensal", yearly: "Anual" };

const ROLE: Record<string, string> = {
  owner: "Dona da conta",
  admin: "Administração",
  staff: "Recepção",
  professional: "Profissional",
};

const EVENT: Record<string, string> = {
  trial_started: "Teste iniciado",
  trial_converted: "Teste virou assinatura",
  created: "Assinatura criada",
  renewed: "Renovação",
  upgraded: "Subiu de plano",
  downgraded: "Desceu de plano",
  cycle_changed: "Troca de ciclo",
  past_due: "Ficou inadimplente",
  recovered: "Pagamento recuperado",
  canceled: "Assinatura cancelada",
  reactivated: "Assinatura reativada",
};

const SOURCE: Record<string, string> = {
  platform_admin: "Painel da plataforma",
  system: "Automático",
  seed: "Carga inicial",
};

/**
 * Agregados (`max(starts_at)`) voltam como string do driver — só as colunas
 * mapeadas viram Date. Uma conversão só, na fronteira de leitura.
 */
function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateOrDash(value: Date | string | null | undefined, pattern = "d MMM yyyy"): string {
  const date = toDate(value);
  return date ? formatTz(date, PLATFORM_TZ, pattern) : "—";
}

function relativeActivity(value: Date | string | null): string {
  const date = toDate(value);
  if (!date) return "Sem uso";
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "Hoje";
  if (days === 1) return "Ontem";
  if (days < 30) return `Há ${days} dias`;
  return formatTz(date, PLATFORM_TZ, "d MMM yyyy");
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePlatformAdmin();
  const account = await getAccount(ctx, Number((await params).id));
  return { title: account?.organization.name ?? "Conta" };
}

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePlatformAdmin();
  const organizationId = Number((await params).id);
  if (!Number.isInteger(organizationId) || organizationId <= 0) notFound();

  const [account, availablePlans] = await Promise.all([
    getAccount(ctx, organizationId),
    listPlans(),
  ]);
  if (!account) notFound();

  const { organization, subscription, mrrCents, members, usage, timeline } = account;
  const status = subscription ? STATUS[subscription.status] : null;
  const suspended = Boolean(organization.suspendedAt);

  return (
    <div>
      <PlatformHeader
        title={organization.name}
        description={[
          subscription?.planName ?? "Sem plano",
          status?.label ?? "Sem assinatura",
          `${formatBRL(mrrCents)} de MRR`,
        ].join(" · ")}
        actions={
          <AccountActions
            organizationId={organization.id}
            organizationName={organization.name}
            suspended={suspended}
            subscription={
              subscription
                ? {
                    status: subscription.status,
                    cycle: subscription.cycle,
                    planId: subscription.planId,
                    planName: subscription.planName,
                    priceCents: subscription.priceCents,
                  }
                : null
            }
            plans={availablePlans.map((plan) => ({
              id: plan.id,
              name: plan.name,
              monthlyPriceCents: plan.monthlyPriceCents,
              yearlyPriceCents: plan.yearlyPriceCents,
              active: plan.active,
            }))}
          />
        }
      />

      <PlatformBody className="space-y-4">
        <Link
          href="/admin/contas"
          className="inline-flex items-center gap-1.5 text-label text-ink-secondary transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-3.5" />
          Todas as contas
        </Link>

        {suspended ? (
          <Card className="border border-danger/25 px-5 py-4">
            <div className="flex items-start gap-3">
              <Ban className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              <div className="min-w-0">
                <p className="text-card text-ink">Conta suspensa — a clínica não consegue entrar</p>
                <p className="mt-1 text-body text-ink-secondary">
                  {organization.suspendedReason || "Sem motivo registrado."}
                </p>
                <p className="mt-1 text-caption text-ink-tertiary">
                  Suspensa em {dateOrDash(organization.suspendedAt, "d MMM yyyy', 'HH:mm")}. A
                  assinatura segue como está: suspensão é acesso, não cobrança.
                </p>
              </div>
            </div>
          </Card>
        ) : null}

        {/* Duas colunas independentes: cada card fica do tamanho do que tem a
            dizer, em vez de esticar para acompanhar o vizinho. */}
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            {/* Assinatura */}
            <Card className="px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-section">Assinatura</h2>
                {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
              </div>
              {subscription ? (
                <dl className="mt-2">
                  <DataRow label="Plano">{subscription.planName}</DataRow>
                  <DataRow label="Ciclo">{CYCLE[subscription.cycle] ?? subscription.cycle}</DataRow>
                  <DataRow label="Preço travado">
                    <span className="tabular">{formatBRL(subscription.priceCents)}</span>
                    <span className="text-ink-tertiary">
                      {subscription.cycle === "yearly" ? " por ano" : " por mês"}
                    </span>
                  </DataRow>
                  <DataRow label="MRR normalizado">
                    <span className="tabular">{formatBRL(mrrCents)}</span>
                  </DataRow>
                  <DataRow label="Início">{dateOrDash(subscription.startedAt)}</DataRow>
                  <DataRow label="Período atual">
                    {subscription.currentPeriodStart || subscription.currentPeriodEnd
                      ? `${dateOrDash(subscription.currentPeriodStart)} → ${dateOrDash(subscription.currentPeriodEnd)}`
                      : "—"}
                  </DataRow>
                  <DataRow label="Fim do teste">{dateOrDash(subscription.trialEndsAt)}</DataRow>
                  {subscription.canceledAt ? (
                    <DataRow label="Cancelada em">
                      {dateOrDash(subscription.canceledAt, "d MMM yyyy', 'HH:mm")}
                    </DataRow>
                  ) : null}
                  {subscription.cancelReason ? (
                    <DataRow label="Motivo">{subscription.cancelReason}</DataRow>
                  ) : null}
                </dl>
              ) : (
                <p className="mt-2 text-body text-ink-secondary">
                  Esta conta ainda não tem assinatura. Enquanto não tiver, ela não entra em nenhum
                  número de receita do painel.
                </p>
              )}

              {subscription && mrrCents === 0 ? (
                <p className="mt-2 text-caption text-ink-secondary">
                  {subscription.status === "trialing"
                    ? "Conta em teste conta como zero no MRR até a conversão."
                    : "Assinatura sem cobrança ativa: entra como zero no MRR."}
                </p>
              ) : null}

              <div className="mt-4 border-t border-line pt-3">
                <h3 className="text-section">Endereço</h3>
                <dl className="mt-1">
                  <DataRow label="Slug">
                    <span className="tabular">{organization.slug}</span>
                  </DataRow>
                  <DataRow label="Agendamento público">
                    {/* O admin de plataforma não tem sessão de clínica: link para
                        dentro do produto daria um desvio de login confuso. A
                        página pública, ao contrário, abre para qualquer um. */}
                    <a
                      href={`/agendar/${organization.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-accent transition-colors hover:text-accent-hover"
                    >
                      /agendar/{organization.slug}
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  </DataRow>
                  <DataRow label="Cliente desde">{dateOrDash(organization.createdAt)}</DataRow>
                  <DataRow label="Fuso">{organization.timezone}</DataRow>
                </dl>
              </div>
            </Card>

            {/* Pessoas com acesso */}
            <Card>
              <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
                <h2 className="text-section">Pessoas com acesso</h2>
                <span className="tabular text-caption text-ink-secondary">{members.length}</span>
              </div>
              {members.length === 0 ? (
                <p className="px-5 pb-4 text-body text-ink-secondary">
                  Ninguém tem acesso a esta conta.
                </p>
              ) : (
                <CardList>
                  {members.map((member) => (
                    <li key={member.email} className="flex items-center gap-3 px-5 py-2.5">
                      <Avatar name={member.name} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-label text-ink">{member.name}</span>
                        <span className="block truncate text-caption text-ink-secondary">
                          {member.email}
                        </span>
                      </span>
                      <Badge tone={member.role === "owner" ? "accent" : "neutral"}>
                        {ROLE[member.role] ?? member.role}
                      </Badge>
                    </li>
                  ))}
                </CardList>
              )}
            </Card>
          </div>

          <div className="space-y-4">
            {/* Uso — num SaaS vertical, conta que não usa é cancelamento com atraso */}
            <Card className="px-5 py-4">
              <h2 className="text-section">Uso</h2>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <Numero rotulo="Atendimentos (30 dias)" valor={usage.appointments30d} />
                <Numero rotulo="Atendimentos no total" valor={usage.appointmentsTotal} />
              </div>
              <dl className="mt-3 border-t border-line pt-2">
                <DataRow label="Clientes">
                  <span className="tabular">{usage.customers.toLocaleString("pt-BR")}</span>
                </DataRow>
                <DataRow label="Profissionais">
                  <span className="tabular">{usage.professionals.toLocaleString("pt-BR")}</span>
                </DataRow>
                <DataRow label="Unidades">
                  <span className="tabular">{usage.branches.toLocaleString("pt-BR")}</span>
                </DataRow>
                <DataRow label="Última atividade">
                  <span
                    className={cn(
                      usage.appointments30d === 0 && subscription?.status === "active"
                        ? "text-attention"
                        : "text-ink",
                    )}
                  >
                    {relativeActivity(usage.lastActivityAt)}
                  </span>
                </DataRow>
              </dl>
              {usage.appointments30d === 0 && subscription?.status === "active" ? (
                <p className="mt-2 text-caption text-ink-secondary">
                  Paga e não usa há 30 dias. É o perfil que cancela no próximo vencimento.
                </p>
              ) : null}
            </Card>

            {/* Linha do tempo — a mesma fonte que alimenta o MRR do painel */}
            <Card>
              <div className="px-5 pb-2 pt-4">
                <h2 className="text-section">Linha do tempo da assinatura</h2>
              </div>
              {timeline.length === 0 ? (
                <p className="px-5 pb-4 text-body text-ink-secondary">
                  Nenhum evento registrado ainda.
                </p>
              ) : (
                <CardList>
                  {timeline.map((event) => {
                    const delta = event.mrrAfterCents - event.mrrBeforeCents;
                    return (
                      <li key={event.id} className="px-5 py-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <span className="text-label text-ink">{EVENT[event.kind] ?? event.kind}</span>
                          <span className="tabular text-caption text-ink-secondary">
                            {dateOrDash(event.occurredAt, "d MMM yyyy', 'HH:mm")}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          {delta === 0 ? (
                            <span className="text-caption text-ink-tertiary">
                              Sem efeito no MRR ({formatBRL(event.mrrAfterCents)})
                            </span>
                          ) : (
                            <>
                              <span className="tabular text-caption text-ink-secondary">
                                {formatBRL(event.mrrBeforeCents)} → {formatBRL(event.mrrAfterCents)}
                              </span>
                              <Badge tone={delta > 0 ? "positive" : "danger"}>
                                {delta > 0 ? "+" : "−"}
                                {formatBRL(Math.abs(delta))}
                              </Badge>
                            </>
                          )}
                        </div>
                        {event.note ? (
                          <p className="mt-1 text-caption text-ink-secondary">{event.note}</p>
                        ) : null}
                        <p className="mt-0.5 text-meta text-ink-tertiary">
                          {SOURCE[event.source] ?? event.source}
                        </p>
                      </li>
                    );
                  })}
                </CardList>
              )}
            </Card>
          </div>
        </div>
      </PlatformBody>
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="rounded-card bg-surface px-4 py-3">
      <p className="text-caption text-ink-secondary">{rotulo}</p>
      <p className="mt-0.5 tabular text-entity text-ink">{valor.toLocaleString("pt-BR")}</p>
    </div>
  );
}
