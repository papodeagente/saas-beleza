import { generateAccountCode } from "@/lib/account-code";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import * as s from "@/db/schema";
import { getWeeklyCohortFunnel } from "./platform-metrics";

/**
 * O funil de coorte contra o Postgres real.
 *
 * A definição de ativação ("primeiro agendamento criado") só vale se o SQL a
 * implementar de fato — e ela mora inteira numa consulta, fora do alcance do
 * TypeScript. O que este teste protege:
 *
 * 1. a conta cai na semana do CADASTRO, não na semana em que ativou;
 * 2. conta sem agendamento nenhum não conta como ativada;
 * 3. a mediana mede cadastro → primeiro agendamento.
 *
 * As asserções são por DIFERENÇA (antes × depois), porque a consulta é
 * cross-tenant por natureza: ela enxerga a Clínica Lumina de demonstração e
 * qualquer conta que outro teste tenha deixado para trás.
 */

const SUFFIX = "vitest-cohort";
const TZ = "America/Sao_Paulo";

type Marco = { semanaISO: string; cadastro: Date };

/** Instante de cadastro dentro de uma semana passada, cortada no fuso da plataforma. */
async function marco(semanasAtras: number): Promise<Marco> {
  const { rows } = await db.execute<{ semana: string; cadastro: Date }>(sql`
    select
      to_char(
        date_trunc('week', now() at time zone ${TZ}) - make_interval(weeks => ${semanasAtras}),
        'YYYY-MM-DD'
      ) as semana,
      (
        date_trunc('week', now() at time zone ${TZ})
          - make_interval(weeks => ${semanasAtras})
          + interval '2 days 10 hours'
      ) at time zone ${TZ} as cadastro
  `);
  const r = (rows as Array<{ semana: string; cadastro: Date }>)[0];
  return { semanaISO: r.semana, cadastro: new Date(r.cadastro) };
}

async function criarConta(nome: string, cadastro: Date) {
  const [org] = await db
    .insert(s.organizations)
    .values({ publicId: generateAccountCode(),
      name: nome,
      slug: `${nome}-${SUFFIX}`,
      timezone: TZ,
      createdAt: cadastro,
    })
    .returning();
  return org;
}

/** Agendamento é o fato de ativação: criado N horas depois do cadastro. */
async function agendar(organizationId: number, cadastro: Date, horasDepois: number) {
  const [branch] = await db
    .insert(s.branches)
    .values({ organizationId, name: "Unidade" })
    .returning();
  const [professional] = await db
    .insert(s.professionals)
    .values({ organizationId, name: "Profissional", commissionBps: 0 })
    .returning();
  const [service] = await db
    .insert(s.services)
    .values({ organizationId, name: "Serviço", durationMin: 60, priceCents: 10000 })
    .returning();
  const [customer] = await db
    .insert(s.customers)
    .values({ organizationId, name: "Cliente", phone: `${organizationId}11111111` })
    .returning();

  const criadoEm = new Date(cadastro.getTime() + horasDepois * 3_600_000);
  await db.insert(s.appointments).values({
    organizationId,
    branchId: branch.id,
    customerId: customer.id,
    professionalId: professional.id,
    serviceId: service.id,
    startsAt: criadoEm,
    endsAt: new Date(criadoEm.getTime() + 3_600_000),
    priceCents: 10000,
    createdAt: criadoEm,
  });
}

type Linha = { created: number; activated: number; paying: number };

async function porSemana(): Promise<Map<string, Linha>> {
  const funil = await getWeeklyCohortFunnel(8);
  return new Map(
    funil.weeks.map((w) => [
      w.weekStartISO,
      { created: w.created, activated: w.activated, paying: w.paying },
    ]),
  );
}

let antes: Map<string, Linha>;
let semanaA: Marco;
let semanaB: Marco;

beforeAll(async () => {
  await limpar();
  antes = await porSemana();

  semanaA = await marco(3);
  semanaB = await marco(2);

  // Semana A: uma conta que ativou 48h depois e outra que nunca agendou.
  const ativou = await criarConta("ativou", semanaA.cadastro);
  await agendar(ativou.id, semanaA.cadastro, 48);
  await criarConta("silenciosa", semanaA.cadastro);

  // Semana B: ativou e virou pagante.
  const pagante = await criarConta("pagante", semanaB.cadastro);
  await agendar(pagante.id, semanaB.cadastro, 6);
  const [plano] = await db.select({ id: s.plans.id }).from(s.plans).limit(1);
  await db.insert(s.subscriptions).values({
    organizationId: pagante.id,
    planId: plano.id,
    status: "active",
    cycle: "monthly",
    priceCents: 9700,
  });
}, 60_000);

afterAll(async () => {
  await limpar();
  await pool.end();
});

describe("funil por coorte semanal", () => {
  it("conta cadastro, ativação e pagamento na semana do CADASTRO", async () => {
    const depois = await porSemana();
    const zero: Linha = { created: 0, activated: 0, paying: 0 };
    const delta = (iso: string): Linha => {
      const a = antes.get(iso) ?? zero;
      const d = depois.get(iso) ?? zero;
      return {
        created: d.created - a.created,
        activated: d.activated - a.activated,
        paying: d.paying - a.paying,
      };
    };

    // Duas contas entraram, só uma agendou: quem nunca agendou não ativou.
    expect(delta(semanaA.semanaISO)).toEqual({ created: 2, activated: 1, paying: 0 });
    expect(delta(semanaB.semanaISO)).toEqual({ created: 1, activated: 1, paying: 1 });
  });

  it("mede a mediana entre o cadastro e o primeiro agendamento", async () => {
    const funil = await getWeeklyCohortFunnel(8);
    const semana = funil.weeks.find((w) => w.weekStartISO === semanaA.semanaISO);

    // Só afirma sobre a mediana se a coorte for exclusivamente nossa — outra
    // conta na mesma semana mudaria o valor sem que nada estivesse errado.
    if ((antes.get(semanaA.semanaISO)?.created ?? 0) === 0) {
      expect(semana?.medianActivationHours).toBe(48);
    }
    expect(semana?.inProgress).toBe(false);
  });

  it("marca a semana em curso, que ainda vai receber contas", async () => {
    const funil = await getWeeklyCohortFunnel(8);
    expect(funil.weeks).toHaveLength(8);
    expect(funil.weeks.at(-1)?.inProgress).toBe(true);
    expect(funil.weeks.filter((w) => w.inProgress)).toHaveLength(1);
  });
});

async function limpar() {
  const orgs = await db
    .select({ id: s.organizations.id })
    .from(s.organizations)
    .where(sql`${s.organizations.slug} like ${`%${SUFFIX}`}`);
  if (orgs.length === 0) return;
  const ids = orgs.map((o) => o.id);
  const inOrgs = sql`organization_id in (${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )})`;
  await db.execute(sql`delete from appointments where ${inOrgs}`);
  await db.execute(sql`delete from services where ${inOrgs}`);
  await db.execute(sql`delete from customers where ${inOrgs}`);
  await db.execute(sql`delete from professionals where ${inOrgs}`);
  await db.execute(sql`delete from subscription_events where ${inOrgs}`);
  await db.execute(sql`delete from subscriptions where ${inOrgs}`);
  await db.execute(sql`delete from branches where ${inOrgs}`);
  await db.execute(sql`delete from organizations where slug like ${`%${SUFFIX}`}`);
}
