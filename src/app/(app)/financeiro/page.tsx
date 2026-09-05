import { asc, eq } from "drizzle-orm";
import { ChevronLeft, ChevronRight, Wallet } from "lucide-react";
import Link from "next/link";
import { PageBody, PageHeader, SectionLabel } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Metric, MetricRow } from "@/components/ui/metric";
import { ProfessionalDot } from "@/components/ui/status-stripe";
import { db } from "@/db";
import { branches } from "@/db/schema";
import { formatBRL, formatBRLCompact } from "@/lib/money";
import { formatTz, formatTzCapitalized } from "@/lib/tz";
import { cn } from "@/lib/utils";
import { requireRole, requireSession } from "@/server/auth";
import {
  type Period,
  currentMonth,
  getCashSummary,
  getCommissionsByProfessional,
  getManagementResult,
  getRevenueByService,
  listTransactions,
} from "@/server/services/finance-service";
import { TransactionForm } from "./transaction-form";

export const metadata = { title: "Financeiro" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: "positive" | "attention" | "danger" | "neutral" }> = {
  paid: { label: "Pago", tone: "positive" },
  pending: { label: "Em aberto", tone: "attention" },
  overdue: { label: "Vencido", tone: "danger" },
  cancelled: { label: "Cancelado", tone: "neutral" },
};

type Filter = "todos" | "entradas" | "saidas" | "em_aberto";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "todos", label: "Todos" },
  { value: "entradas", label: "Entradas" },
  { value: "saidas", label: "Saídas" },
  { value: "em_aberto", label: "Em aberto" },
];

/** "2026-08" → período do mês inteiro. Fora do formato, cai no mês corrente. */
function monthPeriod(month: string): Period {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { fromISO: `${month}-01`, toISO: `${month}-${String(lastDay).padStart(2, "0")}` };
}

function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; filtro?: string }>;
}) {
  const ctx = await requireSession();
  // Comissão dos colegas e resultado da clínica não são assunto de recepção.
  requireRole(ctx, "admin");

  const params = await searchParams;
  const thisMonth = currentMonth(ctx).fromISO.slice(0, 7);
  const requestedMonth = params.mes ?? "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth) ? requestedMonth : thisMonth;
  const period = monthPeriod(month);
  const filter = FILTERS.find((f) => f.value === params.filtro)?.value ?? "todos";

  const [summary, transactions, result, byService, byProfessional, branchOptions] = await Promise.all([
    getCashSummary(ctx, period),
    listTransactions(ctx, period, filter),
    getManagementResult(ctx, period),
    getRevenueByService(ctx, period),
    getCommissionsByProfessional(ctx, period),
    db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.organizationId, ctx.organizationId)).orderBy(asc(branches.name)),
  ]);

  const monthDate = new Date(`${period.fromISO}T12:00:00Z`);
  const monthLabel = formatTzCapitalized(monthDate, ctx.timezone, "MMMM 'de' yyyy");
  const monthName = formatTz(monthDate, ctx.timezone, "MMMM");
  const topRevenue = byService[0]?.total ?? 0;
  const href = (next: { mes?: string; filtro?: Filter }) => {
    const query = new URLSearchParams();
    const targetMonth = next.mes ?? month;
    const targetFilter = next.filtro ?? filter;
    if (targetMonth !== thisMonth) query.set("mes", targetMonth);
    if (targetFilter !== "todos") query.set("filtro", targetFilter);
    const search = query.toString();
    return search ? `/financeiro?${search}` : "/financeiro";
  };

  return (
    <div>
      <PageHeader
        title="Financeiro"
        description={
          month === thisMonth ? "Mês em andamento" : month < thisMonth ? "Mês fechado" : "Mês a vencer"
        }
        actions={
          <div className="flex flex-wrap items-center gap-1">
            <TransactionForm branches={branchOptions} />
            {/* A navegação de mês é UM controle, não quatro peças soltas.
                Sem este agrupamento o flex-wrap quebrava no meio dela quando o
                botão de lançamento não deixava tudo caber numa linha: no
                celular a seta "seguinte" descia sozinha para a linha de baixo,
                longe do mês a que se refere. */}
            <div className="flex items-center gap-1">
              <MonthStep
                href={href({ mes: shiftMonth(month, -1) })}
                label={`Ver ${formatTz(new Date(`${shiftMonth(month, -1)}-01T12:00:00Z`), ctx.timezone, "MMMM 'de' yyyy")}`}
                direction="prev"
              />
              <span className="whitespace-nowrap px-1 text-center text-label text-ink md:min-w-[132px]">
                {monthLabel}
              </span>
              <MonthStep
                href={href({ mes: shiftMonth(month, 1) })}
                label={`Ver ${formatTz(new Date(`${shiftMonth(month, 1)}-01T12:00:00Z`), ctx.timezone, "MMMM 'de' yyyy")}`}
                direction="next"
              />
              {month !== thisMonth ? (
                <Link
                  href={href({ mes: thisMonth })}
                  className="ml-1 inline-flex min-h-[44px] items-center rounded-control px-2 text-label text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink md:min-h-[36px]"
                >
                  Mês atual
                </Link>
              ) : null}
            </div>
          </div>
        }
      />

      <PageBody className="space-y-8">
        {/* Caixa: o que já passou pela conta e o que ainda vai passar */}
        <section aria-labelledby="caixa">
          <SectionLabel>
            <span id="caixa">Caixa do mês</span>
          </SectionLabel>
          {/* Grade própria: 1 → 2 → 4 colunas.
              A do MetricRow (2 no celular, 4 a partir de 640px) foi calibrada
              para números curtos. Aqui os quatro são dinheiro com centavos, e
              "R$ 21.220,00" ocupa 154px: sobravam 129px em 390px de tela, 114px
              em 360px e 127px no tablet de 768px — o último dígito saía cortado
              nos três. Quatro colunas só cabem a partir de 1024px (191px por
              número). Fica local porque as outras telas que usam MetricRow têm
              números curtos e a grade padrão serve bem a elas. */}
          <MetricRow className="mt-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Entrou" value={formatBRL(summary.receivedCents)} tone="positive" />
            <Metric label="Saiu" value={formatBRL(summary.paidOutCents)} />
            <Metric
              label="Ainda entra"
              value={formatBRL(summary.toReceiveCents)}
              hint={
                summary.toReceiveCents > 0 && summary.overdueInCents > 0
                  ? `${formatBRLCompact(summary.overdueInCents)} já venceu`
                  : undefined
              }
            />
            <Metric
              label="Ainda sai"
              value={formatBRL(summary.toPayCents)}
              hint={
                summary.toPayCents > 0 && summary.overdueOutCents > 0
                  ? `${formatBRLCompact(summary.overdueOutCents)} já venceu`
                  : undefined
              }
            />
          </MetricRow>
        </section>

        {/* Uma única resposta final para o mês */}
        <section aria-labelledby="resultado">
          <SectionLabel>
            <span id="resultado">Como fechou o mês</span>
          </SectionLabel>
          <Card className="mt-3">
            <dl className="divide-y divide-line">
              <ResultRow label="Entrou" value={result.revenueCents} />
              <ResultRow label="Custo dos atendimentos" value={-result.variableCostCents} />
              <ResultRow label="Comissões" value={-result.commissionCents} />
              <ResultRow label="Sobrou dos atendimentos" value={result.contributionMarginCents} level="subtotal" />
              <ResultRow label="Saiu" value={-result.expensesCents} />
              <ResultRow label="Resultado do mês" value={result.operatingResultCents} level="total" />
            </dl>
          </Card>
          <p className="mt-2 max-w-[62ch] text-caption text-ink-secondary">
            Conta o que foi recebido no mês, menos o custo dos atendimentos concluídos, as comissões
            apuradas nesses atendimentos (que não viram lançamento) e as contas já pagas. O que
            continua em aberto fica de fora.
          </p>
        </section>

        <div className="grid gap-8 lg:grid-cols-2">
          {/* Receita por serviço */}
          <section aria-labelledby="servicos">
            <SectionLabel>
              <span id="servicos">Receita por serviço</span>
            </SectionLabel>
            {byService.length === 0 ? (
              <Card className="mt-3 px-4 py-4">
                <p className="text-body text-ink-secondary">
                  Nenhum pagamento registrado em {monthLabel.toLowerCase()}.
                </p>
              </Card>
            ) : (
              <ul className="mt-3 space-y-3">
                {/* Chave pelo id: agrupando por serviço, dois homônimos viram
                    duas linhas — e duas linhas com a mesma chave fazem o React
                    reaproveitar a errada ao reordenar. */}
                {byService.map((row) => (
                  <li key={row.id}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-label text-ink">{row.name}</span>
                      <span className="shrink-0 text-label tabular text-ink">
                        {formatBRL(row.total ?? 0)}
                      </span>
                    </div>
                    {/* Barra monocromática: comparação de tamanho, não categoria */}
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                      <div
                        className="h-full rounded-full bg-line-strong"
                        style={{ width: `${topRevenue ? ((row.total ?? 0) / topRevenue) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="mt-1 block text-meta text-ink-secondary">
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
              <Card className="mt-3 px-4 py-4">
                <p className="text-body text-ink-secondary">
                  Nenhuma comissão apurada. Elas nascem quando o atendimento é concluído.
                </p>
              </Card>
            ) : (
              <>
                <Card className="mt-3">
                  <ul className="divide-y divide-line">
                    {byProfessional.map((row) => (
                      <li key={row.name} className="flex min-h-[52px] items-center gap-2.5 px-4 py-2.5">
                        <ProfessionalDot color={row.color} className="size-1.5 shrink-0 rounded-full" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-label text-ink">{row.name}</span>
                          <span className="block text-meta text-ink-secondary">
                            {row.count} {row.count === 1 ? "atendimento" : "atendimentos"}
                          </span>
                        </span>
                        <span className="shrink-0 text-label tabular text-ink">
                          {formatBRL(row.total ?? 0)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
                <p className="mt-2 text-caption text-ink-secondary">
                  Valor a acertar com cada profissional. Já está descontado no resultado do mês, mas
                  ainda não virou lançamento.
                </p>
              </>
            )}
          </section>
        </div>

        {/* Lançamentos */}
        <section aria-labelledby="lancamentos">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionLabel>
              <span id="lancamentos">Lançamentos</span>
            </SectionLabel>
            <nav aria-label="Filtrar lançamentos" className="flex flex-wrap items-center gap-1.5">
              {FILTERS.map((option) => {
                const active = option.value === filter;
                return (
                  <Link
                    key={option.value}
                    href={href({ filtro: option.value })}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "inline-flex min-h-[44px] items-center rounded-control border px-3 text-label transition-colors duration-[120ms] md:min-h-[32px]",
                      active
                        ? "border-accent bg-accent-soft font-medium text-accent"
                        : "border-line text-ink-secondary hover:border-line-strong hover:text-ink",
                    )}
                  >
                    {option.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {transactions.length === 0 ? (
            <Card className="mt-3">
              <EmptyState
                icon={Wallet}
                title={filter === "todos" ? "Nada lançado neste mês" : "Nenhum lançamento com esse filtro"}
                description={
                  filter === "todos"
                    ? "Cada pagamento registrado num atendimento entra aqui automaticamente."
                    : "Troque o filtro acima ou volte para Todos."
                }
              />
            </Card>
          ) : (
            <Card className="mt-3">
              <ul className="divide-y divide-line">
                {transactions.map((row) => {
                  const origin =
                    row.categoryName ?? (row.kind === "income" ? "Atendimento" : "Sem categoria");
                  /**
                   * O título da linha é O QUE FOI VENDIDO.
                   *
                   * Receita que nasce de um atendimento é gravada com a
                   * descrição literal "Atendimento", então a lista de um mês
                   * cheio saía como cinco linhas idênticas chamadas
                   * "Atendimento" e o valor era o único jeito de distinguir
                   * uma da outra. O serviço sobe para o título; a descrição só
                   * volta para a linha de apoio quando ela diz algo que a
                   * origem ainda não disse (lançamento manual amarrado a um
                   * atendimento, por exemplo).
                   */
                  const title = row.serviceName ?? row.description;
                  // Só volta o que ACRESCENTA: descrição que já contém o nome
                  // do serviço é outra forma de dizer o título ("Botox Facial —
                  // Fernanda Duarte" embaixo de "Botox Facial" é eco, não dado).
                  const extraDescription =
                    row.serviceName &&
                    row.description !== origin &&
                    !row.description.includes(row.serviceName)
                      ? row.description
                      : null;
                  // Mesma regra para o cliente: se o nome dele já aparece no
                  // título ou no complemento, repetir só empurra a data para fora.
                  const customer =
                    row.customerName &&
                    !title.includes(row.customerName) &&
                    !(extraDescription ?? "").includes(row.customerName)
                      ? row.customerName
                      : null;
                  const day = formatTz(new Date(`${row.dueDate}T12:00:00Z`), ctx.timezone, "d MMM");
                  return (
                  <li key={row.id} className="flex min-h-[52px] items-center gap-3 px-4 py-2.5">
                    {/* No celular o nome quebra em vez de truncar, e o estado desce
                        para a linha de apoio — a data nunca some de lista de dinheiro. */}
                    <span className="min-w-0 flex-1">
                      <span className="block text-label text-ink line-clamp-2 sm:line-clamp-1">
                        {title}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        <Badge className="sm:hidden" tone={STATUS[row.status]?.tone ?? "neutral"}>
                          {STATUS[row.status]?.label ?? row.status}
                        </Badge>
                        <span className="min-w-0 truncate text-meta text-ink-secondary">
                          {[origin, extraDescription, customer, day].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </span>
                    <Badge
                      className="hidden shrink-0 sm:inline-flex"
                      tone={STATUS[row.status]?.tone ?? "neutral"}
                    >
                      {STATUS[row.status]?.label ?? row.status}
                    </Badge>
                    <span
                      className={cn(
                        "w-[92px] shrink-0 text-right text-label tabular",
                        row.kind === "income" ? "text-positive" : "text-ink",
                      )}
                    >
                      {row.kind === "income" ? "+" : "−"}
                      {formatBRL(row.amountCents)}
                    </span>
                  </li>
                  );
                })}
              </ul>
            </Card>
          )}
          {transactions.length > 0 ? (
            <p className="mt-2 text-caption text-ink-secondary">
              {transactions.length} {transactions.length === 1 ? "lançamento" : "lançamentos"} com
              vencimento em {monthName}.
            </p>
          ) : null}
        </section>
      </PageBody>
    </div>
  );
}

function MonthStep({
  href,
  label,
  direction,
}: {
  href: string;
  label: string;
  direction: "prev" | "next";
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <Link
      href={href}
      aria-label={label}
      className="inline-flex size-11 items-center justify-center rounded-control border border-line text-ink-secondary transition-colors duration-[120ms] hover:border-line-strong hover:text-ink md:size-9"
    >
      <Icon className="size-4" aria-hidden />
    </Link>
  );
}

/**
 * Linha do resultado. A conclusão é o maior número do bloco — e o sinal é
 * conteúdo: valor negativo nunca fica mais discreto que positivo.
 */
function ResultRow({
  label,
  value,
  level = "line",
}: {
  label: string;
  value: number;
  level?: "line" | "subtotal" | "total";
}) {
  const negative = value < 0;
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 px-4",
        level === "line" && "py-2.5",
        level === "subtotal" && "bg-surface py-3",
        level === "total" && "bg-surface-sunken py-3.5",
      )}
    >
      <dt
        className={cn(
          "min-w-0 text-label",
          level === "line" ? "text-ink-secondary" : "font-semibold text-ink",
        )}
      >
        {label}
      </dt>
      <dd
        className={cn(
          "shrink-0 tabular",
          level === "line" && "text-label text-ink",
          level === "subtotal" && (negative ? "text-title text-danger" : "text-title text-ink"),
          level === "total" && (negative ? "text-metric text-danger" : "text-metric text-ink"),
        )}
      >
        {negative ? "−" : ""}
        {formatBRL(Math.abs(value))}
      </dd>
    </div>
  );
}
