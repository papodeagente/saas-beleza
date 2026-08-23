import { startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { format } from "date-fns";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { PlatformBody, PlatformHeader } from "@/components/platform-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Sparkline } from "@/components/ui/sparkline";
import { formatBRL, formatBRLCompact } from "@/lib/money";
import { cn } from "@/lib/utils";
import { requirePlatformAdmin } from "@/server/platform-auth";
import {
  getHealthRatios,
  getLaunchReadiness,
  getMovement,
  getMrrHistory,
  getPlanBreakdown,
  getSnapshot,
  getTrialFunnel,
  getUsage,
} from "@/server/services/platform-metrics";
import { PreLaunch } from "./pre-launch";

export const metadata = { title: "Visão do negócio" };
export const dynamic = "force-dynamic";

const pct = (v: number | null, digits = 1) =>
  v === null ? "—" : `${(v * 100).toFixed(digits)}%`;

export default async function PlatformDashboard() {
  await requirePlatformAdmin();

  const now = new Date();
  const from = startOfMonth(now);
  const to = startOfMonth(subMonths(now, -1));
  const mesAtualLabel = format(from, "MMMM 'de' yyyy", { locale: ptBR });

  // Antes da primeira assinatura não há o que medir. O painel cheio de zeros
  // seria indistinguível de um painel com defeito, então dá lugar ao primeiro
  // passo — e volta sozinho quando existir receita para reportar.
  const readiness = await getLaunchReadiness();
  if (readiness.preLaunch) {
    return (
      <div>
        <PlatformHeader
          title="Visão do negócio"
          description="Nenhuma assinatura ainda — o painel começa a medir na primeira"
        />
        <PlatformBody>
          <PreLaunch readiness={readiness} />
        </PlatformBody>
      </div>
    );
  }

  const [snapshot, movement, history, planBreakdown, trials, usage] = await Promise.all([
    getSnapshot(),
    getMovement(from, to),
    getMrrHistory(12),
    getPlanBreakdown(),
    getTrialFunnel(from, to),
    getUsage(from, to),
  ]);

  const health = await getHealthRatios(from, to, movement, snapshot.arpaCents);

  const mesAtual = mesAtualLabel;
  const serie = history.map((p) => p.mrrCents);
  const mrrMesPassado = history.length >= 2 ? history[history.length - 2].mrrCents : 0;
  const crescimento = mrrMesPassado > 0 ? (snapshot.mrrCents - mrrMesPassado) / mrrMesPassado : null;
  const topPlano = planBreakdown[0];

  return (
    <div>
      <PlatformHeader
        title="Visão do negócio"
        description={`Todas as contas · ${mesAtual.charAt(0).toUpperCase() + mesAtual.slice(1)}`}
      />

      <PlatformBody className="space-y-8">
        {/* Os dois números que respondem "quanto vale o negócio hoje" */}
        <section className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <Card className="px-6 py-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-section">Receita recorrente mensal</p>
                <p className="mt-2 text-[38px] font-extrabold leading-[44px] tracking-[-0.02em] tabular text-ink">
                  {formatBRL(snapshot.mrrCents)}
                </p>
                <p className="mt-1 flex items-center gap-2 text-caption text-ink-secondary">
                  <span>ARR {formatBRL(snapshot.arrCents)}</span>
                  {crescimento !== null ? (
                    <Badge tone={crescimento >= 0 ? "positive" : "danger"}>
                      {crescimento >= 0 ? "+" : ""}
                      {pct(crescimento)} no mês
                    </Badge>
                  ) : null}
                </p>
              </div>
              <div className="text-right">
                <p className="text-section">Ticket médio por conta</p>
                <p className="mt-1 text-metric tabular text-ink">{formatBRL(snapshot.arpaCents)}</p>
              </div>
            </div>

            <div className="-mx-2 mt-4">
              <Sparkline
                points={serie}
                label={`MRR dos últimos ${serie.length} meses`}
                className="w-full"
              />
              <div className="mt-1 flex justify-between px-2 text-meta text-ink-tertiary">
                <span>{history[0]?.monthISO}</span>
                <span>{history.at(-1)?.monthISO}</span>
              </div>
            </div>
          </Card>

          <Card className="divide-y divide-line">
            <div className="px-5 py-4">
              <p className="text-section">Contas</p>
              <p className="mt-1 text-metric tabular text-ink">{snapshot.accounts.paying}</p>
              <p className="text-caption text-ink-secondary">pagantes de {snapshot.accounts.total}</p>
            </div>
            <dl className="px-5 py-3">
              <Linha rotulo="Em teste" valor={snapshot.accounts.trialing} />
              <Linha
                rotulo="Inadimplentes"
                valor={snapshot.accounts.pastDue}
                tom={snapshot.accounts.pastDue > 0 ? "attention" : undefined}
              />
              <Linha
                rotulo="Suspensas"
                valor={snapshot.accounts.suspended}
                tom={snapshot.accounts.suspended > 0 ? "danger" : undefined}
              />
              <Linha rotulo="Canceladas" valor={snapshot.accounts.canceled} />
            </dl>
            <div className="px-5 py-3">
              <Link
                href="/admin/contas"
                className="flex items-center gap-1.5 text-label text-accent transition-colors hover:text-accent-hover"
              >
                Ver todas as contas
                <ArrowRight className="size-3.5" />
              </Link>
            </div>
          </Card>
        </section>

        {/* De onde veio a variação do mês */}
        <section>
          <h2 className="text-section">Movimento de {mesAtual}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Movimento rotulo="Novo" valor={movement.newCents} tom="positive" />
            <Movimento rotulo="Expansão" valor={movement.expansionCents} tom="positive" />
            <Movimento rotulo="Contração" valor={-movement.contractionCents} tom="attention" />
            <Movimento rotulo="Cancelamento" valor={-movement.churnedCents} tom="danger" />
            <Movimento rotulo="Líquido" valor={movement.netCents} destaque />
          </div>
          <p className="mt-2 text-caption text-ink-secondary">
            {movement.newAccounts} {movement.newAccounts === 1 ? "conta entrou" : "contas entraram"} e{" "}
            {movement.churnedAccounts} {movement.churnedAccounts === 1 ? "saiu" : "saíram"} neste mês.
          </p>
        </section>

        {/* Os indicadores que dizem se o negócio se sustenta */}
        <section>
          <h2 className="text-section">Saúde da receita</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Indicador
              rotulo="Retenção líquida de receita"
              valor={pct(health.netRevenueRetention)}
              ajuda="Acima de 100% significa crescer sem cliente novo."
              tom={
                health.netRevenueRetention === null
                  ? undefined
                  : health.netRevenueRetention >= 1
                    ? "positive"
                    : "attention"
              }
            />
            <Indicador
              rotulo="Retenção bruta"
              valor={pct(health.grossRevenueRetention)}
              ajuda="Ignora expansão: mede só o que se perdeu."
            />
            <Indicador
              rotulo="Cancelamento de receita"
              valor={pct(health.revenueChurnRate)}
              ajuda="Do MRR do início do mês, quanto foi embora."
              tom={
                health.revenueChurnRate !== null && health.revenueChurnRate > 0.03
                  ? "danger"
                  : undefined
              }
            />
            <Indicador
              rotulo="Cancelamento de contas"
              valor={pct(health.customerChurnRate)}
              ajuda="Contas que saíram sobre as pagantes no início do mês."
            />
            <Indicador
              rotulo="Quick ratio"
              valor={health.quickRatio === null ? "—" : health.quickRatio.toFixed(1)}
              ajuda="(novo + expansão) ÷ (contração + cancelamento). Acima de 4 é saudável."
              tom={health.quickRatio !== null && health.quickRatio >= 4 ? "positive" : undefined}
            />
            <Indicador
              rotulo="Valor do cliente (LTV)"
              valor={health.ltvCents ? formatBRLCompact(health.ltvCents) : "—"}
              ajuda="Ticket médio dividido pelo cancelamento mensal."
            />
          </div>
          <p className="mt-2 text-caption text-ink-secondary">
            Payback de aquisição e CAC ficam de fora porque o produto ainda não coleta custo de
            marketing. Melhor ausente do que estimado.
          </p>
        </section>

        <div className="grid gap-8 lg:grid-cols-2">
          {/* Testes */}
          <section>
            <h2 className="text-section">Testes</h2>
            <Card className="mt-3 divide-y divide-line">
              <div className="grid grid-cols-2 divide-x divide-line">
                <div className="px-5 py-4">
                  <p className="text-caption text-ink-secondary">Em teste agora</p>
                  <p className="mt-1 text-metric tabular text-ink">{trials.openTrials}</p>
                  {trials.expiringIn7Days > 0 ? (
                    <p className="mt-0.5 text-meta text-attention">
                      {trials.expiringIn7Days} vencendo em 7 dias
                    </p>
                  ) : null}
                </div>
                <div className="px-5 py-4">
                  <p className="text-caption text-ink-secondary">Conversão no mês</p>
                  <p className="mt-1 text-metric tabular text-ink">{pct(trials.conversionRate, 0)}</p>
                  <p className="mt-0.5 text-meta text-ink-secondary">
                    {trials.convertedInPeriod} de {trials.startedInPeriod} iniciados
                  </p>
                </div>
              </div>
            </Card>
          </section>

          {/* Planos */}
          <section>
            <h2 className="text-section">Receita por plano</h2>
            <Card className="mt-3">
              {planBreakdown.length === 0 ? (
                <p className="px-5 py-6 text-body text-ink-secondary">
                  Nenhuma assinatura ativa ainda.
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {planBreakdown.map((plano) => (
                    <li key={plano.planId} className="px-5 py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-label text-ink">{plano.planName}</span>
                        <span className="tabular text-label text-ink">
                          {formatBRL(plano.mrrCents)}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-pill bg-surface-sunken">
                        <div
                          className="h-full rounded-pill bg-accent"
                          style={{
                            width: `${topPlano?.mrrCents ? (plano.mrrCents / topPlano.mrrCents) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <span className="mt-1 block text-meta text-ink-secondary">
                        {plano.accounts} {plano.accounts === 1 ? "conta" : "contas"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </div>

        {/* Uso — num SaaS vertical, conta que não usa é cancelamento com atraso */}
        <section>
          <h2 className="text-section">Uso do produto</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Indicador
              rotulo="Contas ativas (30 dias)"
              valor={String(usage.activeAccounts30d)}
              ajuda={`De ${snapshot.accounts.paying} pagantes. Conta que assina e não usa cancela depois.`}
              tom={
                snapshot.accounts.paying > 0 && usage.activeAccounts30d < snapshot.accounts.paying
                  ? "attention"
                  : undefined
              }
            />
            <Indicador
              rotulo="Atendimentos no mês"
              valor={usage.appointmentsInPeriod.toLocaleString("pt-BR")}
              ajuda="Somando todas as clínicas."
            />
            <Indicador
              rotulo="Volume transacionado"
              valor={formatBRLCompact(usage.gmvCents)}
              ajuda="Quanto as clínicas receberam de clientes delas neste mês."
            />
          </div>
        </section>
      </PlatformBody>
    </div>
  );
}

function Linha({
  rotulo,
  valor,
  tom,
}: {
  rotulo: string;
  valor: number;
  tom?: "attention" | "danger";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-caption text-ink-secondary">{rotulo}</dt>
      <dd
        className={cn(
          "tabular text-label",
          tom === "attention" && "text-attention",
          tom === "danger" && "text-danger",
          !tom && "text-ink",
        )}
      >
        {valor}
      </dd>
    </div>
  );
}

function Movimento({
  rotulo,
  valor,
  tom,
  destaque,
}: {
  rotulo: string;
  valor: number;
  tom?: "positive" | "attention" | "danger";
  destaque?: boolean;
}) {
  return (
    <Card className={cn("px-4 py-3.5", destaque && "ring-1 ring-accent/25")}>
      <p className="text-caption text-ink-secondary">{rotulo}</p>
      <p
        className={cn(
          "mt-1 tabular text-entity",
          destaque
            ? valor >= 0
              ? "text-positive"
              : "text-danger"
            : tom === "positive"
              ? "text-positive"
              : tom === "attention"
                ? "text-attention"
                : tom === "danger"
                  ? "text-danger"
                  : "text-ink",
        )}
      >
        {valor > 0 ? "+" : valor < 0 ? "−" : ""}
        {formatBRL(Math.abs(valor))}
      </p>
    </Card>
  );
}

function Indicador({
  rotulo,
  valor,
  ajuda,
  tom,
}: {
  rotulo: string;
  valor: string;
  ajuda: string;
  tom?: "positive" | "attention" | "danger";
}) {
  return (
    <Card className="px-5 py-4">
      <p className="text-caption text-ink-secondary">{rotulo}</p>
      <p
        className={cn(
          "mt-1 tabular text-metric",
          tom === "positive" && "text-positive",
          tom === "attention" && "text-attention",
          tom === "danger" && "text-danger",
          !tom && "text-ink",
        )}
      >
        {valor}
      </p>
      <p className="mt-1 text-meta leading-4 text-ink-secondary">{ajuda}</p>
    </Card>
  );
}
