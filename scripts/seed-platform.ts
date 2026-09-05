import { addDays, addMonths, startOfMonth, subMonths } from "date-fns";
import { eq, like, sql } from "drizzle-orm";
import { db, pool } from "../src/db";
import * as s from "../src/db/schema";
import { generateAccountCode } from "../src/lib/account-code";

/**
 * Dados da camada de plataforma para o painel do super admin.
 *
 * ADITIVO de propósito: não trunca nada. O `db:seed` da clínica é destrutivo e
 * derrubaria o trabalho de quem estiver testando o produto; este aqui só
 * acrescenta planos, contas de demonstração e o histórico de assinatura.
 *
 * Toda conta criada aqui tem slug com prefixo `demo-`, então some com:
 *   delete from organizations where slug like 'demo-%';
 *
 * A cadeia de eventos é gerada PRIMEIRO e o estado final da assinatura é
 * derivado dela. É o que garante que o MRR somado das assinaturas vivas bata
 * com o último evento de cada uma — se as duas coisas fossem escritas
 * separadamente, o painel se contradiria.
 */

/**
 * Quem recebe acesso de plataforma ao rodar o seed.
 *
 * Era a dona da clínica de demonstração, o que dava ao painel do SaaS inteiro a
 * mesma senha publicada na documentação de demonstração. Agora é o dono do
 * produto, e um ambiente diferente pode apontar para outra pessoa pela variável
 * de ambiente.
 */
const ADMIN_EMAIL = (process.env.PLATFORM_ADMIN_EMAIL ?? "bruno@entur.com.br").trim().toLowerCase();

/** PRNG determinístico: rodar o seed duas vezes dá o mesmo cenário. */
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}
const random = makeRandom(20260822);
const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)];

const PLANS = [
  {
    slug: "essencial",
    name: "Essencial",
    description: "Agenda, clientes e financeiro para quem está começando.",
    monthlyPriceCents: 14900,
    yearlyPriceCents: 149000,
    maxBranches: 1,
    maxProfessionals: 3,
    maxUsers: 3,
    position: 1,
  },
  {
    slug: "profissional",
    name: "Profissional",
    description: "Inclui WhatsApp, agendamento online e relatórios.",
    monthlyPriceCents: 29900,
    yearlyPriceCents: 299000,
    maxBranches: 2,
    maxProfessionals: 10,
    maxUsers: 10,
    position: 2,
  },
  {
    slug: "escala",
    name: "Escala",
    description: "Multiunidade, agente de IA e gestão de comissões.",
    monthlyPriceCents: 59900,
    yearlyPriceCents: 599000,
    maxBranches: null,
    maxProfessionals: null,
    maxUsers: null,
    position: 3,
  },
];

const CLINICAS = [
  "Espaço Renove", "Clínica Belle Pele", "Studio Aurora Estética", "Instituto Vitrá",
  "Derma Vita", "Clínica Lumine Sul", "Bella Forma Estética", "Casa Vitória Beleza",
  "Espaço Alma Estética", "Clínica Nova Face", "Studio Marcela Reis", "Pele & Arte",
  "Clínica Serena", "Espaço Corpo & Alma", "Bio Estética Natal", "Clínica Aura Recife",
];

type Event = {
  kind: (typeof s.subscriptionEventKind.enumValues)[number];
  at: Date;
  before: number;
  after: number;
  planIdBefore: number | null;
  planIdAfter: number | null;
  note?: string;
};

const monthlyOf = (cycle: "monthly" | "yearly", price: number) =>
  cycle === "yearly" ? Math.round(price / 12) : price;

/**
 * Estrutura mínima e alguns atendimentos recentes para uma conta de
 * demonstração. Não tenta imitar uma clínica completa — só o suficiente para
 * as métricas de uso do painel refletirem atividade real.
 */
async function criarUso(organizationId: number, desde: Date, quantidade: number) {
  const [branch] = await db
    .insert(s.branches)
    .values({ organizationId, name: "Unidade principal" })
    .returning();

  const [professional] = await db
    .insert(s.professionals)
    .values({ organizationId, name: "Profissional", commissionBps: 3000 })
    .returning();

  const [service] = await db
    .insert(s.services)
    .values({
      organizationId,
      name: "Atendimento",
      durationMin: 60,
      priceCents: 18000 + Math.floor(random() * 12) * 1000,
      minLeadMinutes: 0,
      maxLeadDays: 365,
    })
    .returning();

  const [customer] = await db
    .insert(s.customers)
    .values({ organizationId, name: "Cliente de demonstração" })
    .returning();

  const now = new Date();
  const rows: Array<typeof s.appointments.$inferInsert> = [];
  for (let i = 0; i < quantidade; i += 1) {
    // Um por dia, sempre às 10:00 — o EXCLUDE constraint proíbe sobreposição
    // no mesmo profissional, então espaçar por dia é o caminho seguro.
    const dia = new Date(now);
    dia.setDate(dia.getDate() - (i + 1));
    dia.setHours(10, 0, 0, 0);
    if (dia < desde) break;
    rows.push({
      organizationId,
      branchId: branch.id,
      customerId: customer.id,
      professionalId: professional.id,
      serviceId: service.id,
      startsAt: dia,
      endsAt: new Date(dia.getTime() + 60 * 60_000),
      priceCents: service.priceCents,
      status: "completed",
    });
  }
  if (rows.length > 0) await db.insert(s.appointments).values(rows);
}

async function main() {
  const now = new Date();

  // ---- Planos (idempotente por slug) -------------------------------------
  const planIdBySlug = new Map<string, number>();
  for (const plan of PLANS) {
    const [row] = await db
      .insert(s.plans)
      .values({ ...plan, trialDays: 14, active: true })
      .onConflictDoUpdate({
        target: s.plans.slug,
        set: {
          name: plan.name,
          description: plan.description,
          monthlyPriceCents: plan.monthlyPriceCents,
          yearlyPriceCents: plan.yearlyPriceCents,
        },
      })
      .returning({ id: s.plans.id });
    planIdBySlug.set(plan.slug, row.id);
  }
  const planPrice = (slug: string, cycle: "monthly" | "yearly") => {
    const p = PLANS.find((x) => x.slug === slug)!;
    return cycle === "yearly" ? p.yearlyPriceCents : p.monthlyPriceCents;
  };

  // ---- Acesso de plataforma ----------------------------------------------
  const [admin] = await db.select().from(s.users).where(eq(s.users.email, ADMIN_EMAIL)).limit(1);
  if (admin) {
    await db.insert(s.platformAdmins).values({ userId: admin.id }).onConflictDoNothing();
  } else {
    // Silêncio aqui viraria um painel sem dono: melhor dizer o que faltou.
    console.warn(
      `[seed-platform] nenhum usuário com o e-mail ${ADMIN_EMAIL}: ninguém recebeu acesso de plataforma. ` +
        "Crie a conta e rode scripts/definir-super-admin.ts.",
    );
  }

  // ---- Provedor de pagamento (desligado até o token chegar) ---------------
  await db
    .insert(s.paymentProviders)
    .values({
      kind: "hotmart",
      name: "Hotmart",
      enabled: false,
      config: { note: "Aguardando o hottok do webhook." },
    })
    .onConflictDoNothing();

  // ---- Contas de demonstração --------------------------------------------
  //
  // NÃO rodam por padrão. Estas clínicas não existem, e um painel de negócio
  // com receita inventada leva a decisão errada — o vazio pelo menos é honesto
  // e se corrige sozinho no primeiro cliente. Só entram com `--demo`, para
  // avaliar o painel cheio antes de ter base real.
  if (!process.argv.includes("--demo")) {
    console.log("Planos, acesso de plataforma e provedor de pagamento prontos.");
    console.log("Contas de demonstração não foram criadas (use --demo se quiser vê-las).");
    return;
  }
  console.warn("--demo: criando contas FICTÍCIAS. Use scripts/remover-dados-ficticios.ts para apagar.");

  // Limpa apenas o que este script cria, para poder rodar de novo.
  const existing = await db
    .select({ id: s.organizations.id })
    .from(s.organizations)
    .where(like(s.organizations.slug, "demo-%"));
  if (existing.length > 0) {
    const ids = sql.join(existing.map((o) => sql`${o.id}`), sql`, `);
    // A ordem respeita as chaves estrangeiras: o que aponta some antes do
    // apontado. Só toca em conta com slug `demo-`.
    await db.execute(sql`delete from subscription_events where organization_id in (${ids})`);
    await db.execute(sql`delete from platform_charges where organization_id in (${ids})`);
    await db.execute(sql`delete from subscriptions where organization_id in (${ids})`);
    await db.execute(sql`delete from appointment_history where organization_id in (${ids})`);
    await db.execute(sql`delete from appointments where organization_id in (${ids})`);
    await db.execute(sql`delete from customers where organization_id in (${ids})`);
    await db.execute(sql`delete from professional_services where organization_id in (${ids})`);
    await db.execute(sql`delete from services where organization_id in (${ids})`);
    await db.execute(sql`delete from professionals where organization_id in (${ids})`);
    await db.execute(sql`delete from branches where organization_id in (${ids})`);
    await db.execute(sql`delete from organizations where id in (${ids})`);
  }

  let criadas = 0;
  let cancelamentoNoMesFeito = false;
  for (const [index, nome] of CLINICAS.entries()) {
    const slug = `demo-${nome.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
    // Distribui as entradas de 12 meses atrás até o mês corrente. Chegar a zero
    // importa: sem nenhuma entrada no mês atual o painel abre com o movimento
    // zerado e parece inerte, embora o número esteja certo.
    const ultimo = CLINICAS.length - 1;
    const mesesAtras = 12 - Math.round((index / ultimo) * 12);
    const entrada =
      // A última conta entra agora e fica EM TESTE; a penúltima entra há ~3
      // semanas, então o teste dela venceu dentro deste mês e ela aparece como
      // conversão no movimento. Os dois casos precisam existir para o painel
      // conseguir demonstrar o funil.
      index === ultimo
        ? addDays(now, -3 - Math.floor(random() * 6))
        : index === ultimo - 1
          ? addDays(now, -20 - Math.floor(random() * 4))
          : addDays(startOfMonth(subMonths(now, mesesAtras)), Math.floor(random() * 26));

    const [org] = await db
      .insert(s.organizations)
      .values({ publicId: generateAccountCode(), name: nome, slug, timezone: "America/Sao_Paulo", createdAt: entrada })
      .returning();

    const cycle: "monthly" | "yearly" = random() < 0.25 ? "yearly" : "monthly";
    let planSlug = pick(["essencial", "essencial", "profissional", "profissional", "escala"]);
    let price = planPrice(planSlug, cycle);
    let mrr = monthlyOf(cycle, price);

    const events: Event[] = [];
    const trialEnd = addDays(entrada, 14);
    events.push({
      kind: "trial_started",
      at: entrada,
      before: 0,
      after: 0,
      planIdBefore: null,
      planIdAfter: planIdBySlug.get(planSlug)!,
    });

    // 20% não convertem o teste.
    const converteu = random() > 0.2;
    let status: (typeof s.subscriptionStatus.enumValues)[number] = "trialing";
    let canceledAt: Date | null = null;
    let startedAt: Date | null = null;

    if (trialEnd > now) {
      status = "trialing";
    } else if (!converteu) {
      status = "canceled";
      canceledAt = trialEnd;
      events.push({
        kind: "canceled",
        at: trialEnd,
        before: 0,
        after: 0,
        planIdBefore: planIdBySlug.get(planSlug)!,
        planIdAfter: null,
        note: "Não converteu o teste",
      });
      mrr = 0;
    } else {
      startedAt = trialEnd;
      status = "active";
      events.push({
        kind: "trial_converted",
        at: trialEnd,
        before: 0,
        after: mrr,
        planIdBefore: planIdBySlug.get(planSlug)!,
        planIdAfter: planIdBySlug.get(planSlug)!,
      });

      // Mudança de plano em alguns casos, sempre depois de 2 meses.
      const mudou = random();
      const dataMudanca = addMonths(trialEnd, 2 + Math.floor(random() * 4));
      if (dataMudanca < now && mudou < 0.22 && planSlug !== "escala") {
        const antes = mrr;
        const antesPlano = planIdBySlug.get(planSlug)!;
        planSlug = planSlug === "essencial" ? "profissional" : "escala";
        price = planPrice(planSlug, cycle);
        mrr = monthlyOf(cycle, price);
        events.push({
          kind: "upgraded",
          at: dataMudanca,
          before: antes,
          after: mrr,
          planIdBefore: antesPlano,
          planIdAfter: planIdBySlug.get(planSlug)!,
        });
      } else if (dataMudanca < now && mudou > 0.9 && planSlug !== "essencial") {
        const antes = mrr;
        const antesPlano = planIdBySlug.get(planSlug)!;
        planSlug = planSlug === "escala" ? "profissional" : "essencial";
        price = planPrice(planSlug, cycle);
        mrr = monthlyOf(cycle, price);
        events.push({
          kind: "downgraded",
          at: dataMudanca,
          before: antes,
          after: mrr,
          planIdBefore: antesPlano,
          planIdAfter: planIdBySlug.get(planSlug)!,
        });
      }

      // Cancelamento eventual.
      // Um cancelamento é puxado para dentro do mês corrente de propósito: sem
      // churn no período, churn de receita, LTV e quick ratio ficam todos sem
      // valor e o painel não consegue demonstrar o que calcula.
      // Marca a PRIMEIRA conta que chegou até aqui (ou seja, converteu de
      // fato). Prender o cancelamento a um índice fixo falhava quando aquela
      // conta caía no ramo de teste não convertido.
      const forcarNoMes = !cancelamentoNoMesFeito;
      const dataCancel = forcarNoMes
        ? addDays(startOfMonth(now), 3 + Math.floor(random() * 10))
        : addMonths(trialEnd, 3 + Math.floor(random() * 8));
      if (dataCancel < now && (forcarNoMes || random() < 0.3)) {
        events.push({
          kind: "canceled",
          at: dataCancel,
          before: mrr,
          after: 0,
          planIdBefore: planIdBySlug.get(planSlug)!,
          planIdAfter: null,
          note: pick(["Fechou a clínica", "Foi para concorrente", "Preço", "Parou de usar"]),
        });
        status = "canceled";
        canceledAt = dataCancel;
        mrr = 0;
        if (forcarNoMes) cancelamentoNoMesFeito = true;
      } else if (random() < 0.12) {
        status = "past_due";
        events.push({
          kind: "past_due",
          at: addDays(now, -Math.floor(random() * 20) - 1),
          before: mrr,
          after: mrr,
          planIdBefore: planIdBySlug.get(planSlug)!,
          planIdAfter: planIdBySlug.get(planSlug)!,
          note: "Cobrança recusada",
        });
      }
    }

    const [sub] = await db
      .insert(s.subscriptions)
      .values({
        organizationId: org.id,
        planId: planIdBySlug.get(planSlug)!,
        status,
        cycle,
        priceCents: price,
        trialEndsAt: trialEnd,
        startedAt,
        currentPeriodStart: startedAt,
        currentPeriodEnd: startedAt ? addMonths(startedAt, cycle === "yearly" ? 12 : 1) : null,
        canceledAt,
        createdAt: entrada,
      })
      .returning();

    await db.insert(s.subscriptionEvents).values(
      events.map((e) => ({
        organizationId: org.id,
        subscriptionId: sub.id,
        kind: e.kind,
        mrrBeforeCents: e.before,
        mrrAfterCents: e.after,
        planIdBefore: e.planIdBefore,
        planIdAfter: e.planIdAfter,
        source: "system",
        note: e.note ?? null,
        occurredAt: e.at,
      })),
    );

    // Uso mínimo do produto para as contas vivas. Sem isto a métrica de contas
    // ativas nos últimos 30 dias fica enganosa: mostraria quase zero uso num
    // painel com 12 assinaturas pagas, sugerindo um problema que não existe.
    if (status !== "canceled") {
      await criarUso(org.id, entrada, status === "trialing" ? 3 : 6 + Math.floor(random() * 10));
    }

    // Suspende uma conta inadimplente para o painel ter o caso.
    if (status === "past_due" && random() < 0.4) {
      await db
        .update(s.organizations)
        .set({ suspendedAt: new Date(), suspendedReason: "Inadimplência acima de 30 dias" })
        .where(eq(s.organizations.id, org.id));
    }

    criadas += 1;
  }

  // ---- A clínica real do seed vira assinante paga ------------------------
  const [lumina] = await db
    .select()
    .from(s.organizations)
    .where(eq(s.organizations.slug, "clinica-lumina"))
    .limit(1);

  if (lumina) {
    const planId = planIdBySlug.get("escala")!;
    const price = planPrice("escala", "monthly");
    const entrada = subMonths(now, 10);
    const inicio = addDays(entrada, 14);

    await db.execute(sql`delete from subscription_events where organization_id = ${lumina.id}`);
    await db.execute(sql`delete from subscriptions where organization_id = ${lumina.id}`);

    const [sub] = await db
      .insert(s.subscriptions)
      .values({
        organizationId: lumina.id,
        planId,
        status: "active",
        cycle: "monthly",
        priceCents: price,
        trialEndsAt: inicio,
        startedAt: inicio,
        currentPeriodStart: startOfMonth(now),
        currentPeriodEnd: addMonths(startOfMonth(now), 1),
        createdAt: entrada,
      })
      .returning();

    await db.insert(s.subscriptionEvents).values([
      {
        organizationId: lumina.id,
        subscriptionId: sub.id,
        kind: "trial_started",
        mrrBeforeCents: 0,
        mrrAfterCents: 0,
        planIdAfter: planId,
        occurredAt: entrada,
      },
      {
        organizationId: lumina.id,
        subscriptionId: sub.id,
        kind: "trial_converted",
        mrrBeforeCents: 0,
        mrrAfterCents: price,
        planIdBefore: planId,
        planIdAfter: planId,
        occurredAt: inicio,
      },
    ]);
  }

  const [resumo] = await db.execute<{ contas: number; mrr: number; eventos: number }>(sql`
    select
      (select count(*) from subscriptions where status in ('active','past_due'))::int as contas,
      (select coalesce(sum(case when cycle='yearly' then round(price_cents::numeric/12) else price_cents end),0)
         from subscriptions where status in ('active','past_due'))::int as mrr,
      (select count(*) from subscription_events)::int as eventos
  `).then((r) => r.rows as { contas: number; mrr: number; eventos: number }[]);

  console.log(`Contas de demonstração criadas: ${criadas}`);
  console.log(`Assinaturas pagantes: ${resumo.contas}`);
  console.log(`MRR: R$ ${(resumo.mrr / 100).toLocaleString("pt-BR")}`);
  console.log(`Eventos de assinatura: ${resumo.eventos}`);
  console.log(admin ? `Acesso de plataforma: ${ADMIN_EMAIL}` : "ATENÇÃO: usuário admin não encontrado");
}

main()
  .then(() => pool.end())
  .catch((error) => {
    console.error(error);
    pool.end();
    process.exit(1);
  });
