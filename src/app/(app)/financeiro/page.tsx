import { Wallet } from "lucide-react";
import { PageHeader, SectionLabel } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatBRL, formatBRLCompact } from "@/lib/money";
import { formatTzCapitalized } from "@/lib/tz";
import { cn } from "@/lib/utils";
import { requireSession } from "@/server/auth";
import {
  currentMonth,
  getCashSummary,
  getCommissionsByProfessional,
  getManagementResult,
  getRevenueByService,
  listTransactions,
} from "@/server/services/finance-service";

export const metadata = { title: "Financeiro — Lumina" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: "positive" | "attention" | "danger" | "neutral" }> = {
  paid: { label: "Pago", tone: "positive" },
  pending: { label: "Em aberto", tone: "attention" },
  overdue: { label: "Vencido", tone: "danger" },
  cancelled: { label: "Cancelado", tone: "neutral" },
};

export default async function FinancePage() {
  const ctx = await requireSession();
  const period = currentMonth(ctx);

  const [summary, transactions, result, byService, byProfessional] = await Promise.all([
    getCashSummary(ctx, period),
    listTransactions(ctx, period),
    getManagementResult(ctx, period),
    getRevenueByService(ctx, period),
    getCommissionsByProfessional(ctx, period),
  ]);

  const monthLabel = formatTzCapitalized(
    new Date(`${period.fromISO}T12:00:00Z`),
    ctx.timezone,
    "MMMM 'de' yyyy",
  );
  const topRevenue = byService[0]?.total ?? 0;

  return (
    <div>
      <PageHeader title="Financeiro" description={monthLabel} />

      <div className="mx-auto max-w-[1120px] space-y-9 px-5 py-6 md:px-8">
        {/* Fluxo de caixa — as quatro perguntas do dono */}
        <section aria-labelledby="caixa">
          <SectionLabel>
            <span id="caixa">Caixa do mês</span>
          </SectionLabel>
          <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius)] border border-line bg-line lg:grid-cols-4">
            <Metric label="Entrou" value={formatBRL(summary.receivedCents)} tone="positive" />
            <Metric label="Saiu" value={formatBRL(summary.paidOutCents)} />
            <Metric
              label="Ainda entra"
              value={formatBRL(summary.toReceiveCents)}
              hint={summary.overdueInCents > 0 ? `${formatBRLCompact(summary.overdueInCents)} vencido` : undefined}
            />
            <Metric
              label="Ainda sai"
              value={formatBRL(summary.toPayCents)}
              hint={summary.overdueOutCents > 0 ? `${formatBRLCompact(summary.overdueOutCents)} vencido` : undefined}
            />
          </div>
          <p className="mt-2 text-[12px] text-ink-tertiary">
            Saldo realizado no mês:{" "}
            <span className={cn("font-medium tabular", summary.balanceCents >= 0 ? "text-positive" : "text-danger")}>
              {formatBRL(summary.balanceCents)}
            </span>
          </p>
        </section>

        {/* DRE gerencial */}
        <section aria-labelledby="resultado">
          <SectionLabel>
            <span id="resultado">Resultado gerencial</span>
          </SectionLabel>
          <dl className="mt-3 divide-y divide-line overflow-hidden rounded-[var(--radius)] border border-line bg-surface-raised">
            <ResultRow label="Receita recebida" value={result.revenueCents} />
            <ResultRow label="Custos variáveis" value={-result.variableCostCents} />
            <ResultRow label="Comissões" value={-result.commissionCents} />
            <ResultRow label="Margem de contribuição" value={result.contributionMarginCents} emphasis />
            <ResultRow label="Despesas pagas" value={-result.expensesCents} />
            <ResultRow label="Resultado operacional" value={result.operatingResultCents} emphasis />
          </dl>
        </section>

        <div className="grid gap-8 lg:grid-cols-2">
          {/* Receita por serviço */}
          <section aria-labelledby="servicos">
            <SectionLabel>
              <span id="servicos">Receita por serviço</span>
            </SectionLabel>
            {byService.length === 0 ? (
              <p className="mt-3 rounded-[var(--radius)] border border-line bg-surface-raised px-4 py-4 text-[13px] text-ink-secondary">
                Nenhum pagamento registrado neste mês ainda.
              </p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {byService.map((row) => (
                  <li key={row.name}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[13px] text-ink">{row.name}</span>
                      <span className="shrink-0 text-[13px] tabular text-ink">
                        {formatBRL(row.total ?? 0)}
                      </span>
                    </div>
                    {/* Barra monocromática: comparação de tamanho, não categoria */}
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-sunken">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${topRevenue ? ((row.total ?? 0) / topRevenue) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="mt-0.5 block text-[11px] text-ink-tertiary">
                      {row.count} {row.count === 1 ? "atendimento" : "atendimentos"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Comissões */}
          <section aria-labelledby="comissoes">
            <SectionLabel>
              <span id="comissoes">Comissões do mês</span>
            </SectionLabel>
            {byProfessional.length === 0 ? (
              <p className="mt-3 rounded-[var(--radius)] border border-line bg-surface-raised px-4 py-4 text-[13px] text-ink-secondary">
                Nenhuma comissão gerada. Elas são calculadas quando o atendimento é concluído.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[var(--radius)] border border-line bg-surface-raised">
                {byProfessional.map((row) => (
                  <li key={row.name} className="flex items-center gap-3 px-4 py-2.5">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: row.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{row.name}</span>
                    <span className="text-[11px] text-ink-tertiary">
                      {row.count} {row.count === 1 ? "atend." : "atends."}
                    </span>
                    <span className="w-24 text-right text-[13px] font-medium tabular text-ink">
                      {formatBRL(row.total ?? 0)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Lançamentos */}
        <section aria-labelledby="lancamentos">
          <SectionLabel>
            <span id="lancamentos">Lançamentos</span>
          </SectionLabel>
          {transactions.length === 0 ? (
            <div className="mt-3 rounded-[var(--radius)] border border-line bg-surface-raised">
              <EmptyState
                icon={Wallet}
                title="Nada lançado neste mês"
                description="Cada pagamento registrado num atendimento entra aqui automaticamente."
              />
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[var(--radius)] border border-line bg-surface-raised">
              {transactions.map((row) => (
                <li key={row.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      row.kind === "income" ? "bg-positive" : "bg-ink-tertiary",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">{row.description}</span>
                    <span className="block truncate text-[11px] text-ink-tertiary">
                      {row.categoryName ?? (row.kind === "income" ? "Atendimento" : "Sem categoria")}
                      {row.customerName ? ` · ${row.customerName}` : ""}
                    </span>
                  </span>
                  <span className="hidden w-20 shrink-0 text-[12px] tabular text-ink-tertiary sm:block">
                    {row.dueDate.split("-").reverse().slice(0, 2).join("/")}
                  </span>
                  <Badge tone={STATUS[row.status]?.tone ?? "neutral"}>
                    {STATUS[row.status]?.label ?? row.status}
                  </Badge>
                  <span
                    className={cn(
                      "w-24 shrink-0 text-right text-[13px] tabular",
                      row.kind === "income" ? "text-positive" : "text-ink",
                    )}
                  >
                    {row.kind === "income" ? "+" : "−"}
                    {formatBRL(row.amountCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "positive";
}) {
  return (
    <div className="bg-surface-raised px-4 py-3.5">
      <p className="text-[12px] text-ink-tertiary">{label}</p>
      <p
        className={cn(
          "mt-1 text-[19px] font-semibold leading-6 tabular",
          tone === "positive" ? "text-positive" : "text-ink",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-danger">{hint}</p> : null}
    </div>
  );
}

function ResultRow({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 px-4 py-2.5",
        emphasis && "bg-surface",
      )}
    >
      <dt className={cn("text-[13px]", emphasis ? "font-medium text-ink" : "text-ink-secondary")}>
        {label}
      </dt>
      <dd
        className={cn(
          "text-[13px] tabular",
          emphasis ? "font-semibold" : "",
          value < 0 ? "text-ink-secondary" : emphasis ? "text-ink" : "text-ink",
        )}
      >
        {value < 0 ? "−" : ""}
        {formatBRL(Math.abs(value))}
      </dd>
    </div>
  );
}
