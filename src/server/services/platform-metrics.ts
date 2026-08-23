import "server-only";
import { and, count, eq, gte, inArray, lt, sql, sum } from "drizzle-orm";
import { db } from "@/db";
import {
  appointments,
  organizations,
  payments,
  plans,
  subscriptionEvents,
  subscriptions,
} from "@/db/schema";

/**
 * Métricas de negócio do SaaS.
 *
 * Este módulo é CROSS-TENANT por definição: quem opera a plataforma enxerga
 * todas as contas. Por isso ele nunca recebe `TenantContext` e nunca deve ser
 * importado por uma tela de clínica — o guard é `requirePlatformAdmin`.
 *
 * Duas convenções que sustentam todos os números:
 *
 * 1. MRR é sempre NORMALIZADO em mês. Um plano anual entra por 1/12 do valor,
 *    nunca pelo valor cheio no mês da cobrança — senão a receita recorrente
 *    vira um serrote e deixa de significar qualquer coisa.
 * 2. O valor ATUAL sai da soma das assinaturas vivas; o MOVIMENTO do período
 *    (novo, expansão, contração, churn) sai do log de eventos, que guarda o
 *    MRR antes e depois de cada mudança. Sem esse log não há como reconstituir
 *    de onde a variação veio.
 */

/** Assinaturas que contam como receita recorrente. Teste não gera receita. */
const REVENUE_STATUSES = ["active", "past_due"] as const;

/** MRR normalizado de uma assinatura, em centavos. */
export function normalizedMrrCents(cycle: string, priceCents: number): number {
  return cycle === "yearly" ? Math.round(priceCents / 12) : priceCents;
}

const MRR_EXPR = sql<number>`
  coalesce(sum(
    case when ${subscriptions.cycle} = 'yearly'
      then round(${subscriptions.priceCents}::numeric / 12)
      else ${subscriptions.priceCents}
    end
  ), 0)::int
`;

export type Snapshot = {
  mrrCents: number;
  arrCents: number;
  arpaCents: number;
  accounts: {
    total: number;
    paying: number;
    trialing: number;
    pastDue: number;
    canceled: number;
    suspended: number;
  };
};

export async function getSnapshot(): Promise<Snapshot> {
  const [[mrrRow], statusRows, [orgRow]] = await Promise.all([
    db
      .select({ mrr: MRR_EXPR })
      .from(subscriptions)
      .where(inArray(subscriptions.status, [...REVENUE_STATUSES])),
    db
      .select({ status: subscriptions.status, total: count() })
      .from(subscriptions)
      .groupBy(subscriptions.status),
    db
      .select({
        total: count(),
        suspended: sql<number>`count(*) filter (where ${organizations.suspendedAt} is not null)::int`,
      })
      .from(organizations),
  ]);

  const byStatus = Object.fromEntries(statusRows.map((r) => [r.status, r.total]));
  const paying = (byStatus.active ?? 0) + (byStatus.past_due ?? 0);
  const mrrCents = mrrRow?.mrr ?? 0;

  return {
    mrrCents,
    arrCents: mrrCents * 12,
    arpaCents: paying > 0 ? Math.round(mrrCents / paying) : 0,
    accounts: {
      total: orgRow?.total ?? 0,
      paying,
      trialing: byStatus.trialing ?? 0,
      pastDue: byStatus.past_due ?? 0,
      canceled: byStatus.canceled ?? 0,
      suspended: orgRow?.suspended ?? 0,
    },
  };
}

export type Movement = {
  newCents: number;
  expansionCents: number;
  contractionCents: number;
  churnedCents: number;
  netCents: number;
  churnedAccounts: number;
  newAccounts: number;
};

/**
 * Movimento de MRR no período. Cada categoria é a diferença entre o MRR antes
 * e depois do evento, para que a soma feche com a variação real do mês.
 */
export async function getMovement(from: Date, to: Date): Promise<Movement> {
  const [row] = await db
    .select({
      newCents: sql<number>`coalesce(sum(case when ${subscriptionEvents.kind} in ('created','trial_converted','reactivated') then ${subscriptionEvents.mrrAfterCents} - ${subscriptionEvents.mrrBeforeCents} else 0 end), 0)::int`,
      expansionCents: sql<number>`coalesce(sum(case when ${subscriptionEvents.kind} in ('upgraded','cycle_changed') and ${subscriptionEvents.mrrAfterCents} > ${subscriptionEvents.mrrBeforeCents} then ${subscriptionEvents.mrrAfterCents} - ${subscriptionEvents.mrrBeforeCents} else 0 end), 0)::int`,
      contractionCents: sql<number>`coalesce(sum(case when ${subscriptionEvents.kind} in ('downgraded','cycle_changed') and ${subscriptionEvents.mrrBeforeCents} > ${subscriptionEvents.mrrAfterCents} then ${subscriptionEvents.mrrBeforeCents} - ${subscriptionEvents.mrrAfterCents} else 0 end), 0)::int`,
      churnedCents: sql<number>`coalesce(sum(case when ${subscriptionEvents.kind} = 'canceled' then ${subscriptionEvents.mrrBeforeCents} - ${subscriptionEvents.mrrAfterCents} else 0 end), 0)::int`,
      churnedAccounts: sql<number>`count(*) filter (where ${subscriptionEvents.kind} = 'canceled')::int`,
      newAccounts: sql<number>`count(*) filter (where ${subscriptionEvents.kind} in ('created','trial_converted'))::int`,
    })
    .from(subscriptionEvents)
    .where(and(gte(subscriptionEvents.occurredAt, from), lt(subscriptionEvents.occurredAt, to)));

  const m = row ?? {
    newCents: 0,
    expansionCents: 0,
    contractionCents: 0,
    churnedCents: 0,
    churnedAccounts: 0,
    newAccounts: 0,
  };

  return {
    ...m,
    netCents: m.newCents + m.expansionCents - m.contractionCents - m.churnedCents,
  };
}

export type HealthRatios = {
  /** Proporção de contas pagantes que cancelaram no período. */
  customerChurnRate: number | null;
  /** Proporção do MRR do início do período que foi perdida. */
  revenueChurnRate: number | null;
  /** Receita líquida retida: acima de 1 significa crescer sem cliente novo. */
  netRevenueRetention: number | null;
  /** Retenção bruta: ignora expansão, só mede o que se perdeu. */
  grossRevenueRetention: number | null;
  /** (novo + expansão) / (contração + churn). Acima de 4 é saudável. */
  quickRatio: number | null;
  /** ARPA / churn mensal de clientes. Null quando não houve churn. */
  ltvCents: number | null;
  /** Meses até recuperar o custo de aquisição — exige dado de marketing. */
  monthsToRecoverCac: null;
};

/**
 * MRR num instante do passado: para cada assinatura, o último evento anterior
 * à data manda. É o mesmo método usado no histórico do gráfico.
 */
export async function getMrrAt(instant: Date): Promise<number> {
  const [row] = await db.execute<{ mrr: number }>(sql`
    with ultimo as (
      select distinct on (subscription_id)
             subscription_id, mrr_after_cents
      from subscription_events
      where subscription_id is not null and occurred_at < ${instant.toISOString()}
      order by subscription_id, occurred_at desc
    )
    select coalesce(sum(mrr_after_cents), 0)::int as mrr from ultimo
  `).then((r) => r.rows as { mrr: number }[]);
  return row?.mrr ?? 0;
}

export async function getHealthRatios(
  from: Date,
  to: Date,
  movement: Movement,
  arpaCents: number,
): Promise<HealthRatios> {
  const mrrStart = await getMrrAt(from);

  const [payingAtStart] = await db.execute<{ total: number }>(sql`
    with ultimo as (
      select distinct on (subscription_id) subscription_id, mrr_after_cents
      from subscription_events
      where subscription_id is not null and occurred_at < ${from.toISOString()}
      order by subscription_id, occurred_at desc
    )
    select count(*) filter (where mrr_after_cents > 0)::int as total from ultimo
  `).then((r) => r.rows as { total: number }[]);

  const base = payingAtStart?.total ?? 0;
  const customerChurnRate = base > 0 ? movement.churnedAccounts / base : null;
  const revenueChurnRate = mrrStart > 0 ? movement.churnedCents / mrrStart : null;

  const denominator = movement.contractionCents + movement.churnedCents;

  return {
    customerChurnRate,
    revenueChurnRate,
    netRevenueRetention:
      mrrStart > 0
        ? (mrrStart + movement.expansionCents - movement.contractionCents - movement.churnedCents) /
          mrrStart
        : null,
    grossRevenueRetention:
      mrrStart > 0 ? (mrrStart - movement.contractionCents - movement.churnedCents) / mrrStart : null,
    quickRatio: denominator > 0 ? (movement.newCents + movement.expansionCents) / denominator : null,
    ltvCents:
      customerChurnRate && customerChurnRate > 0 ? Math.round(arpaCents / customerChurnRate) : null,
    // Exige custo de aquisição, que o produto não coleta. Melhor ausente que inventado.
    monthsToRecoverCac: null,
  };
}

export type MrrPoint = { monthISO: string; mrrCents: number };

/** MRR ao fim de cada mês dos últimos N meses. */
export async function getMrrHistory(months = 12): Promise<MrrPoint[]> {
  const result = await db.execute<{ mes: string; mrr: number }>(sql`
    with meses as (
      select generate_series(
        date_trunc('month', now()) - (${months - 1} || ' months')::interval,
        date_trunc('month', now()),
        interval '1 month'
      ) as m
    ),
    assinaturas as (
      select distinct subscription_id from subscription_events where subscription_id is not null
    ),
    ponto as (
      select meses.m,
             (select e.mrr_after_cents
                from subscription_events e
               where e.subscription_id = assinaturas.subscription_id
                 and e.occurred_at < meses.m + interval '1 month'
               order by e.occurred_at desc
               limit 1) as mrr
        from meses cross join assinaturas
    )
    select to_char(m, 'YYYY-MM') as mes, coalesce(sum(mrr), 0)::int as mrr
      from ponto group by m order by m
  `);
  return (result.rows as { mes: string; mrr: number }[]).map((r) => ({
    monthISO: r.mes,
    mrrCents: r.mrr,
  }));
}

export type PlanBreakdown = {
  planId: number;
  planName: string;
  accounts: number;
  mrrCents: number;
};

export async function getPlanBreakdown(): Promise<PlanBreakdown[]> {
  return db
    .select({
      planId: plans.id,
      planName: plans.name,
      accounts: count(),
      mrrCents: MRR_EXPR,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(inArray(subscriptions.status, [...REVENUE_STATUSES]))
    .groupBy(plans.id, plans.name)
    .orderBy(sql`4 desc`);
}

export type TrialFunnel = {
  openTrials: number;
  startedInPeriod: number;
  convertedInPeriod: number;
  conversionRate: number | null;
  expiringIn7Days: number;
};

export async function getTrialFunnel(from: Date, to: Date): Promise<TrialFunnel> {
  const in7Days = new Date(Date.now() + 7 * 86_400_000);

  const [[open], [started], [converted]] = await Promise.all([
    db
      .select({
        total: count(),
        expiring: sql<number>`count(*) filter (where ${subscriptions.trialEndsAt} <= ${in7Days.toISOString()})::int`,
      })
      .from(subscriptions)
      .where(eq(subscriptions.status, "trialing")),
    db
      .select({ total: count() })
      .from(subscriptionEvents)
      .where(
        and(
          eq(subscriptionEvents.kind, "trial_started"),
          gte(subscriptionEvents.occurredAt, from),
          lt(subscriptionEvents.occurredAt, to),
        ),
      ),
    db
      .select({ total: count() })
      .from(subscriptionEvents)
      .where(
        and(
          eq(subscriptionEvents.kind, "trial_converted"),
          gte(subscriptionEvents.occurredAt, from),
          lt(subscriptionEvents.occurredAt, to),
        ),
      ),
  ]);

  return {
    openTrials: open?.total ?? 0,
    expiringIn7Days: open?.expiring ?? 0,
    startedInPeriod: started?.total ?? 0,
    convertedInPeriod: converted?.total ?? 0,
    conversionRate: started?.total ? (converted?.total ?? 0) / started.total : null,
  };
}

/**
 * Fuso em que a plataforma corta a semana.
 *
 * Métrica cross-tenant não tem "fuso do tenant" para respeitar, e cortar em UTC
 * jogaria o cadastro de domingo à noite em São Paulo para a semana seguinte —
 * bem no ponto em que a coorte vira. O produto é brasileiro; a semana dele
 * também.
 */
const PLATFORM_TZ = "America/Sao_Paulo";

export type CohortWeek = {
  /** Segunda-feira da semana de cadastro, em `YYYY-MM-DD` no fuso da plataforma. */
  weekStartISO: string;
  created: number;
  activated: number;
  paying: number;
  /** Mediana entre o cadastro e o primeiro agendamento, em horas. */
  medianActivationHours: number | null;
  /** A semana em curso ainda vai receber gente: comparar com as fechadas engana. */
  inProgress: boolean;
};

export type CohortFunnel = {
  weeks: CohortWeek[];
  totals: {
    created: number;
    activated: number;
    paying: number;
    activationRate: number | null;
    payingRate: number | null;
    medianActivationHours: number | null;
  };
};

/**
 * Funil de aquisição por COORTE SEMANAL de cadastro.
 *
 * Somar tudo num período só faz o funil mentir: quem se cadastrou ontem ainda
 * não teve chance de virar pagante, e entra no denominador arrastando a taxa
 * para baixo. Cada linha aqui acompanha as contas que ENTRARAM naquela semana,
 * pelo tempo que for — é a única leitura em que a conversão de uma semana pode
 * ser comparada com a de outra.
 *
 * ATIVAÇÃO = primeiro agendamento criado na agenda da conta.
 *
 * Não é login (dá para logar e sair sem nada acontecer), não é "cadastro
 * completo" (preencher formulário não é usar). Agendar é o único fato que prova
 * que a clínica tirou um horário do caderno e colocou aqui dentro. É o mesmo
 * ato que sustenta todo o resto do produto — sem agendamento não há lembrete,
 * não há comissão e não há caixa —, então uma conta que nunca agendou não está
 * usando a Lumina, esteja pagando ou não.
 */
export async function getWeeklyCohortFunnel(weeks = 8): Promise<CohortFunnel> {
  const { rows } = await db.execute<{
    semana: string | null;
    criadas: number;
    ativadas: number;
    pagantes: number;
    mediana_segundos: number | string | null;
  }>(sql`
    with semanas as (
      select generate_series(
        date_trunc('week', now() at time zone ${PLATFORM_TZ}) - make_interval(weeks => ${weeks - 1}),
        date_trunc('week', now() at time zone ${PLATFORM_TZ}),
        interval '1 week'
      )::date as inicio
    ),
    contas as (
      select
        o.id,
        o.created_at,
        date_trunc('week', o.created_at at time zone ${PLATFORM_TZ})::date as semana,
        (select min(a.created_at) from appointments a where a.organization_id = o.id) as ativou_em,
        (
          exists (
            select 1 from subscriptions s
             where s.organization_id = o.id and s.status in ('active', 'past_due')
          )
          -- Quem pagou e cancelou depois converteu do mesmo jeito: a coorte
          -- mede a passagem, não o saldo de hoje.
          or exists (
            select 1 from subscription_events e
             where e.organization_id = o.id and e.mrr_after_cents > 0
          )
        ) as pagante
      from organizations o
      where o.created_at >= ((select min(inicio) from semanas)::timestamp at time zone ${PLATFORM_TZ})
    )
    select
      to_char(s.inicio, 'YYYY-MM-DD') as semana,
      count(c.id)::int as criadas,
      count(c.ativou_em)::int as ativadas,
      count(*) filter (where c.pagante)::int as pagantes,
      percentile_cont(0.5) within group (
        order by extract(epoch from (c.ativou_em - c.created_at))::float8
      ) filter (where c.ativou_em is not null) as mediana_segundos
    from semanas s
    left join contas c on c.semana = s.inicio
    -- A linha do total sai da MESMA varredura (grouping sets) porque a mediana
    -- do conjunto não é a média das medianas das semanas.
    group by grouping sets ((s.inicio), ())
    order by s.inicio nulls first
  `);

  const horas = (segundos: number | string | null) =>
    segundos === null ? null : Math.round((Number(segundos) / 3600) * 10) / 10;

  const linhas = rows as Array<{
    semana: string | null;
    criadas: number;
    ativadas: number;
    pagantes: number;
    mediana_segundos: number | string | null;
  }>;

  const total = linhas.find((r) => r.semana === null);
  const semanas = linhas.filter((r) => r.semana !== null);
  const ultima = semanas.at(-1)?.semana;

  return {
    weeks: semanas.map((r) => ({
      weekStartISO: r.semana as string,
      created: r.criadas,
      activated: r.ativadas,
      paying: r.pagantes,
      medianActivationHours: horas(r.mediana_segundos),
      inProgress: r.semana === ultima,
    })),
    totals: {
      created: total?.criadas ?? 0,
      activated: total?.ativadas ?? 0,
      paying: total?.pagantes ?? 0,
      activationRate: total?.criadas ? (total.ativadas ?? 0) / total.criadas : null,
      payingRate: total?.criadas ? (total.pagantes ?? 0) / total.criadas : null,
      medianActivationHours: horas(total?.mediana_segundos ?? null),
    },
  };
}

export type UsageMetrics = {
  activeAccounts30d: number;
  appointmentsInPeriod: number;
  gmvCents: number;
};

/**
 * Uso real do produto pelas clínicas. Num SaaS vertical isso vale tanto quanto
 * a receita: conta que assina e não usa é churn com atraso.
 */
export async function getUsage(from: Date, to: Date): Promise<UsageMetrics> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

  const [[active], [appts], [gmv]] = await Promise.all([
    db
      .select({ total: sql<number>`count(distinct ${appointments.organizationId})::int` })
      .from(appointments)
      .where(gte(appointments.startsAt, thirtyDaysAgo)),
    db
      .select({ total: count() })
      .from(appointments)
      .where(and(gte(appointments.startsAt, from), lt(appointments.startsAt, to))),
    db
      .select({ total: sum(payments.amountCents).mapWith(Number) })
      .from(payments)
      .where(and(gte(payments.paidAt, from), lt(payments.paidAt, to))),
  ]);

  return {
    activeAccounts30d: active?.total ?? 0,
    appointmentsInPeriod: appts?.total ?? 0,
    gmvCents: gmv?.total ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Estado inicial
// ---------------------------------------------------------------------------

export type LaunchReadiness = {
  /** Zero assinaturas EM QUALQUER MOMENTO — não é um mês fraco, é o começo. */
  preLaunch: boolean;
  organizations: number;
  activePlans: number;
  /** Provedor ligado E com o segredo que ele usa guardado — só isso cobra. */
  liveProviders: number;
  configuredProviders: number;
  platformAdmins: number;
};

/**
 * Um painel de negócio recém-nascido mostra a mesma coisa que um painel
 * quebrado: tudo zerado. A diferença é o contexto, e é isso que esta consulta
 * traz — quantas peças já estão de pé e qual falta.
 */
export async function getLaunchReadiness(): Promise<LaunchReadiness> {
  const { rows } = await db.execute<{
    orgs: number;
    subs: number;
    active_plans: number;
    live_providers: number;
    configured_providers: number;
    admins: number;
  }>(sql`
    select
      (select count(*) from organizations)::int as orgs,
      (select count(*) from subscriptions)::int as subs,
      (select count(*) from plans where active)::int as active_plans,
      -- Só "credentials" dava sempre zero: NADA escreve nessa coluna hoje. O
      -- caminho real de salvar provedor (saveProvider, em services/hotmart.ts)
      -- grava o segredo do webhook em "webhook_token_hash", e "credentials"
      -- está reservada para a chave de API de um provedor que ainda não existe.
      -- Com a condição antiga o passo "Cobrança" do painel inicial nunca ficava
      -- verde, nem com a Hotmart ligada e validando entrega — o painel dizia
      -- que faltava fazer o que já estava feito. As duas colunas contam porque
      -- são o mesmo fato dito de dois jeitos: o provedor tem o segredo de que
      -- precisa para operar.
      (select count(*) from payment_providers
        where enabled
          and (webhook_token_hash is not null or credentials is not null))::int as live_providers,
      (select count(*) from payment_providers)::int as configured_providers,
      (select count(*) from platform_admins)::int as admins
  `);
  const r = (rows as Array<Record<string, number>>)[0];

  return {
    preLaunch: r.subs === 0,
    organizations: r.orgs,
    activePlans: r.active_plans,
    liveProviders: r.live_providers,
    configuredProviders: r.configured_providers,
    platformAdmins: r.admins,
  };
}
