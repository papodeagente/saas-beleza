import { addDays, subDays } from "date-fns";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import * as s from "@/db/schema";
import { generateAccountCode } from "@/lib/account-code";
import { getAccountAccess } from "./account-access";
import { buscarSaloes, cidadesComSalao, perfilPublico } from "./marketplace-service";

/**
 * O diretório, contra o Postgres real.
 *
 * O teste que mais importa aqui é o da MATRIZ DE ESTADOS COMERCIAIS. O
 * marketplace repete a regra de `getAccountAccess` em SQL, porque a original é
 * por conta e faria uma consulta por cartão da lista. Duas verdades sobre a
 * mesma regra saem de sincronia — a menos que alguém as confronte. É o que este
 * arquivo faz.
 */

const SUFIXO = "vitest-marketplace";
/** Natal/RN — cidade real da base de municípios, com coordenada de verdade. */
const NATAL = 2408102;
const NATAL_LAT = -5.79357;
const NATAL_LNG = -35.1986;
/** Parnamirim/RN fica a ~15km de Natal: serve para provar a ordenação. */
const PARNAMIRIM = 2403251;

type Conta = { id: number; slug: string };

/**
 * `subscriptions.plan_id` e `price_cents` são NOT NULL — assinatura sem plano
 * não existe no modelo. Um plano só, criado uma vez, serve a todos os casos:
 * o que está em teste aqui é o STATUS, não o preço.
 */
let planoId: number;

async function garantirPlano(): Promise<number> {
  const [plano] = await db
    .insert(s.plans)
    .values({
      name: "Plano de teste",
      slug: `plano-${SUFIXO}`,
      monthlyPriceCents: 9900,
      yearlyPriceCents: 99000,
      active: false,
      publicVisible: false,
    })
    .onConflictDoNothing({ target: s.plans.slug })
    .returning({ id: s.plans.id });
  if (plano) return plano.id;
  const [existente] = await db
    .select({ id: s.plans.id })
    .from(s.plans)
    .where(sql`${s.plans.slug} = ${`plano-${SUFIXO}`}`)
    .limit(1);
  return existente.id;
}

async function criarConta(
  nome: string,
  opcoes: {
    listed?: boolean;
    ibge?: number;
    comServico?: boolean;
    ativa?: boolean;
    assinatura?: Partial<typeof s.subscriptions.$inferInsert>;
    suspensa?: boolean;
  } = {},
): Promise<Conta> {
  const {
    listed = true,
    ibge = NATAL,
    comServico = true,
    ativa = true,
    assinatura,
    suspensa = false,
  } = opcoes;

  const [org] = await db
    .insert(s.organizations)
    .values({
      publicId: generateAccountCode(),
      name: nome,
      slug: `${nome}-${SUFIXO}`.toLowerCase().replace(/\s+/g, "-"),
      timezone: "America/Sao_Paulo",
      marketplaceListed: listed,
      marketplaceBio: "Alongamento e blindagem.",
      suspendedAt: suspensa ? new Date() : null,
    })
    .returning();

  const [municipio] = await db
    .select()
    .from(s.municipios)
    .where(sql`${s.municipios.ibgeCode} = ${ibge}`)
    .limit(1);

  await db.insert(s.branches).values({
    organizationId: org.id,
    name: "Unidade",
    active: ativa,
    city: municipio.name,
    uf: municipio.uf,
    ibgeCode: municipio.ibgeCode,
    lat: municipio.lat,
    lng: municipio.lng,
    geoSource: "cep",
    geoPrecision: "cidade",
    geocodedAt: new Date(),
  });

  if (comServico) {
    await db.insert(s.services).values({
      organizationId: org.id,
      name: "Alongamento em gel",
      durationMin: 90,
      priceCents: 18000,
      active: true,
      onlineBooking: true,
    });
  }

  if (assinatura) {
    await db.insert(s.subscriptions).values({
      organizationId: org.id,
      planId: planoId,
      priceCents: 9900,
      status: "trialing",
      ...assinatura,
    });
  }

  return { id: org.id, slug: org.slug };
}

async function limpar() {
  const orgs = await db
    .select({ id: s.organizations.id })
    .from(s.organizations)
    .where(sql`${s.organizations.slug} like ${`%${SUFIXO}`}`);
  if (!orgs.length) return;
  const ids = sql.join(
    orgs.map((o) => sql`${o.id}`),
    sql`, `,
  );
  for (const tabela of [
    "subscription_events",
    "subscriptions",
    "services",
    "branches",
    "organization_members",
  ]) {
    await db.execute(sql.raw(`delete from ${tabela} where organization_id in (${orgs.map((o) => o.id).join(",")})`));
  }
  await db.execute(sql`delete from organizations where id in (${ids})`);
  await db.execute(sql`delete from plans where slug = ${`plano-${SUFIXO}`}`);
}

beforeAll(async () => {
  await limpar();
  planoId = await garantirPlano();
}, 60_000);

afterAll(async () => {
  await limpar();
  await pool.end();
});

/** Só os salões deste teste — a base real tem outras contas. */
function meus<T extends { slug: string }>(itens: T[]): T[] {
  return itens.filter((i) => i.slug.endsWith(SUFIXO));
}

describe("quem aparece no diretório", () => {
  it("mostra o salão que optou, tem endereço e tem serviço publicado", async () => {
    const conta = await criarConta("Studio Alfa");
    const { itens } = await buscarSaloes({ ibgeCode: NATAL, porPagina: 48 });
    const achado = meus(itens).find((i) => i.slug === conta.slug);
    expect(achado).toBeTruthy();
    expect(achado!.cidade).toBe("Natal");
    expect(achado!.servicos).toBe(1);
    expect(achado!.precoMinCents).toBe(18000);
  });

  it("esconde quem não ligou o interruptor", async () => {
    const conta = await criarConta("Studio Fechado", { listed: false });
    const { itens } = await buscarSaloes({ ibgeCode: NATAL, porPagina: 48 });
    expect(meus(itens).some((i) => i.slug === conta.slug)).toBe(false);
  });

  it("esconde quem não tem nenhum serviço publicado", async () => {
    // Vitrine com a porta aberta e a prateleira vazia não é oferta.
    const conta = await criarConta("Studio Sem Servico", { comServico: false });
    const { itens } = await buscarSaloes({ ibgeCode: NATAL, porPagina: 48 });
    expect(meus(itens).some((i) => i.slug === conta.slug)).toBe(false);
  });

  it("esconde a unidade desativada", async () => {
    const conta = await criarConta("Studio Inativo", { ativa: false });
    const { itens } = await buscarSaloes({ ibgeCode: NATAL, porPagina: 48 });
    expect(meus(itens).some((i) => i.slug === conta.slug)).toBe(false);
  });

  it("o perfil concorda com a busca", async () => {
    const listado = await criarConta("Studio Perfil");
    const escondido = await criarConta("Studio Oculto", { listed: false });
    expect(await perfilPublico(listado.slug)).toBeTruthy();
    // Salão que aparece na lista e dá 404 ao abrir é pior que ausente — e o
    // contrário também: perfil aberto de quem escolheu não estar no diretório.
    expect(await perfilPublico(escondido.slug)).toBeNull();
  });
});

/**
 * A matriz que amarra as duas implementações da mesma regra.
 *
 * Para cada estado comercial: `getAccountAccess` diz se a conta pode operar, e
 * o diretório diz se ela aparece. As duas respostas têm de ser a MESMA. Se
 * alguém mexer numa e esquecer a outra, cai aqui.
 */
describe("portão comercial: SQL do diretório × getAccountAccess", () => {
  const agora = new Date();
  const casos: Array<{
    nome: string;
    opcoes: Parameters<typeof criarConta>[1];
    esperado: boolean;
  }> = [
    { nome: "Sem Assinatura", opcoes: {}, esperado: true },
    {
      nome: "Teste Em Dia",
      opcoes: { assinatura: { status: "trialing", trialEndsAt: addDays(agora, 5) } },
      esperado: true,
    },
    {
      nome: "Teste Vencido",
      opcoes: { assinatura: { status: "trialing", trialEndsAt: subDays(agora, 1) } },
      esperado: false,
    },
    {
      nome: "Teste Sem Prazo",
      opcoes: { assinatura: { status: "trialing", trialEndsAt: null } },
      esperado: true,
    },
    { nome: "Ativa", opcoes: { assinatura: { status: "active" } }, esperado: true },
    {
      // Cobrança falhou, mas a clínica é cliente pagante: cortar no primeiro
      // boleto atrasado perde quem ia pagar. O painel conta past_due como
      // receita — os dois lados precisam concordar.
      nome: "Inadimplente",
      opcoes: { assinatura: { status: "past_due" } },
      esperado: true,
    },
    {
      nome: "Cancelada Com Periodo Pago",
      opcoes: {
        assinatura: { status: "canceled", currentPeriodEnd: addDays(agora, 10) },
      },
      esperado: true,
    },
    {
      nome: "Cancelada Periodo Findo",
      opcoes: {
        assinatura: { status: "canceled", currentPeriodEnd: subDays(agora, 1) },
      },
      esperado: false,
    },
    {
      nome: "Cancelada Sem Data",
      opcoes: { assinatura: { status: "canceled" } },
      esperado: false,
    },
    { nome: "Suspensa", opcoes: { suspensa: true }, esperado: false },
  ];

  for (const caso of casos) {
    it(`${caso.nome}: aparece = ${caso.esperado}`, async () => {
      const conta = await criarConta(caso.nome, caso.opcoes);

      const acesso = await getAccountAccess(conta.id);
      const { itens } = await buscarSaloes({ ibgeCode: NATAL, porPagina: 48 });
      const apareceNoDiretorio = meus(itens).some((i) => i.slug === conta.slug);

      expect(acesso.allowed, `getAccountAccess para ${caso.nome}`).toBe(caso.esperado);
      expect(apareceNoDiretorio, `diretório para ${caso.nome}`).toBe(caso.esperado);
      // A afirmação que amarra as duas:
      expect(apareceNoDiretorio).toBe(acesso.allowed);
    });
  }
});

describe("ordenação por proximidade", () => {
  it("põe a cidade da pessoa antes da cidade vizinha", async () => {
    const daqui = await criarConta("Studio Natal", { ibge: NATAL });
    const vizinho = await criarConta("Studio Parnamirim", { ibge: PARNAMIRIM });

    // Sem filtro de cidade: a coordenada é que ordena.
    const { itens } = await buscarSaloes({ lat: NATAL_LAT, lng: NATAL_LNG, porPagina: 48 });
    const ordem = meus(itens).map((i) => i.slug);
    expect(ordem.indexOf(daqui.slug)).toBeGreaterThanOrEqual(0);
    expect(ordem.indexOf(vizinho.slug)).toBeGreaterThan(ordem.indexOf(daqui.slug));

    const natal = itens.find((i) => i.slug === daqui.slug)!;
    const parnamirim = itens.find((i) => i.slug === vizinho.slug)!;
    expect(natal.km!).toBeLessThan(2);
    expect(parnamirim.km!).toBeGreaterThan(10);
    // A precisão viaja junto com a distância: é ela que impede a tela de
    // escrever "a 800m" com dado de centro de município.
    expect(natal.precisao).toBe("cidade");
  });

  it("conta as cidades que têm salão", async () => {
    await criarConta("Studio Cidades", { ibge: NATAL });
    const cidades = await cidadesComSalao(50);
    const natal = cidades.find((c) => c.ibgeCode === NATAL);
    expect(natal).toBeTruthy();
    expect(natal!.saloes).toBeGreaterThanOrEqual(1);
  });
});

describe("busca por texto", () => {
  it("acha pelo nome do serviço, não só pelo nome do salão", async () => {
    const conta = await criarConta("Studio Texto");
    const porServico = await buscarSaloes({ termo: "alongamento", porPagina: 48 });
    expect(meus(porServico.itens).some((i) => i.slug === conta.slug)).toBe(true);

    const porNome = await buscarSaloes({ termo: "studio texto", porPagina: 48 });
    expect(meus(porNome.itens).some((i) => i.slug === conta.slug)).toBe(true);

    const nada = await buscarSaloes({ termo: "zzzznaoexiste", porPagina: 48 });
    expect(meus(nada.itens).length).toBe(0);
  });
});
