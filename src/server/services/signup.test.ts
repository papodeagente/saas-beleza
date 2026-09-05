import { and, eq, gte, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pool } from "@/db";
import * as s from "@/db/schema";
import { SIGNUP_MAX_PER_HOUR, SIGNUP_MAX_PER_IP_PER_HOUR, signUp } from "./signup";

/**
 * Testes do autocadastro público contra o Postgres real.
 *
 * O QUE ESTE ARQUIVO PROTEGE, em ordem de gravidade:
 *  1. e-mail já cadastrado NÃO vira sessão nem conta (era tomada de conta);
 *  2. `start` é sempre teste — visitante não grava receita no MRR do painel;
 *  3. nome que viraria endereço reservado é recusado;
 *  4. o limite por IP recusa ANTES do bcrypt.
 *
 * `hashPassword` é substituído por um espião: é a única forma de provar (4) —
 * um limite que só recusa depois de gastar 250ms de CPU por tentativa é um
 * amplificador, não um limite. De quebra o arquivo roda rápido.
 */
const { espiaoHash } = vi.hoisted(() => ({ espiaoHash: vi.fn() }));

vi.mock("@/server/auth", () => ({
  hashPassword: async (senha: string) => {
    espiaoHash();
    return `fake-hash:${senha}`;
  },
}));

const SUFIXO = "vitest-signup";
const PLANO_SLUG = `plano-${SUFIXO}`;
const IP_BASE = "203.0.113.";
const EMAIL_EXISTENTE = `existente-${SUFIXO}@example.test`;
const EMAIL_NOVO = `nova-${SUFIXO}@example.test`;

let planoId = 0;

function entrada(over: Partial<Parameters<typeof signUp>[0]> = {}) {
  return {
    clinicName: `Clínica ${SUFIXO}`,
    ownerName: "Maria Fernandes",
    email: EMAIL_NOVO,
    phone: "(84) 99123-4518",
    password: "senha-forte-123",
    planSlug: PLANO_SLUG,
    cycle: "monthly" as const,
    timezone: "America/Sao_Paulo",
    ip: `${IP_BASE}10`,
    honeypot: "",
    // O formulário foi entregue há um minuto: passa no tempo mínimo.
    formIssuedAtMs: Date.now() - 60_000,
    ...over,
  };
}

/** Contagem do que o cadastro cria. Nenhum caminho recusado pode mexer nisto. */
async function inventario() {
  const { rows } = await db.execute<{
    orgs: number;
    usuarios: number;
    assinaturas: number;
    sessoes: number;
  }>(sql`
    select
      (select count(*) from organizations where slug like ${`%${SUFIXO}%`})::int as orgs,
      (select count(*) from users where email like ${`%${SUFIXO}%`})::int as usuarios,
      (select count(*) from subscriptions where plan_id = ${planoId})::int as assinaturas,
      (select count(*) from sessions se
        join users u on u.id = se.user_id
        where u.email like ${`%${SUFIXO}%`})::int as sessoes
  `);
  return (rows as Array<Record<string, number>>)[0];
}

async function limpar() {
  const orgs = await db
    .select({ id: s.organizations.id })
    .from(s.organizations)
    .where(like(s.organizations.slug, `%${SUFIXO}%`));

  for (const org of orgs) {
    await db.delete(s.subscriptionEvents).where(eq(s.subscriptionEvents.organizationId, org.id));
    await db.delete(s.subscriptions).where(eq(s.subscriptions.organizationId, org.id));
    await db
      .delete(s.organizationMembers)
      .where(eq(s.organizationMembers.organizationId, org.id));
    await db.delete(s.branches).where(eq(s.branches.organizationId, org.id));
    await db.delete(s.organizations).where(eq(s.organizations.id, org.id));
  }

  const usuarios = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(like(s.users.email, `%${SUFIXO}%`));
  for (const u of usuarios) {
    await db.delete(s.sessions).where(eq(s.sessions.userId, u.id));
    await db.delete(s.users).where(eq(s.users.id, u.id));
  }

  await db.delete(s.signupAttempts).where(like(s.signupAttempts.ip, `${IP_BASE}%`));
  await db.delete(s.plans).where(eq(s.plans.slug, PLANO_SLUG));
}

beforeAll(async () => {
  await limpar();
  const [plano] = await db
    .insert(s.plans)
    .values({
      name: "Plano de teste",
      slug: PLANO_SLUG,
      monthlyPriceCents: 9700,
      yearlyPriceCents: 97000,
      trialDays: 14,
      active: true,
      publicVisible: true,
    })
    .returning({ id: s.plans.id });
  planoId = plano.id;
});

afterAll(async () => {
  await limpar();
  await pool.end();
});

beforeEach(() => {
  espiaoHash.mockClear();
});

describe("autocadastro", () => {
  it("cria a conta em teste, com evento de MRR zero e o telefone de quem assina", async () => {
    const antes = await inventario();
    const resultado = await signUp(entrada({ ip: `${IP_BASE}11` }));

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    // Só aqui o bcrypt pode ter rodado — é o que dá sentido às asserções de
    // "não gastou hash" dos outros testes.
    expect(espiaoHash).toHaveBeenCalled();

    const [assinatura] = await db
      .select()
      .from(s.subscriptions)
      .where(eq(s.subscriptions.organizationId, resultado.organizationId));

    expect(assinatura.status).toBe("trialing");
    expect(assinatura.priceCents).toBe(9700);
    expect(assinatura.startedAt).toBeNull();
    expect(assinatura.trialEndsAt).not.toBeNull();

    const [evento] = await db
      .select()
      .from(s.subscriptionEvents)
      .where(eq(s.subscriptionEvents.organizationId, resultado.organizationId));

    expect(evento.kind).toBe("trial_started");
    expect(evento.mrrAfterCents).toBe(0);
    // Autoria derivada do ator: o autocadastro não consegue assinar como painel.
    expect(evento.source).toBe("self_signup");

    const [dono] = await db.select().from(s.users).where(eq(s.users.id, resultado.ownerUserId));
    expect(dono.email).toBe(EMAIL_NOVO);
    expect(dono.phone).toBe("84991234518");

    // A clínica nasce utilizável: sem unidade a agenda não abre.
    const unidades = await db
      .select()
      .from(s.branches)
      .where(eq(s.branches.organizationId, resultado.organizationId));
    expect(unidades).toHaveLength(1);

    const depois = await inventario();
    expect(depois.orgs).toBe(antes.orgs + 1);
  });

  it("não deixa o formulário escolher receita: nunca existe caminho para 'active'", async () => {
    // `SignupInput` não tem `start`, então o teste vale como contrato: o dia em
    // que alguém acrescentar o campo, esta linha para de compilar.
    const resultado = await signUp(
      entrada({
        ip: `${IP_BASE}12`,
        email: `receita-${SUFIXO}@example.test`,
        // @ts-expect-error o cliente não tem como pedir assinatura ativa
        start: "active",
      }),
    );
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    const [assinatura] = await db
      .select()
      .from(s.subscriptions)
      .where(eq(s.subscriptions.organizationId, resultado.organizationId));
    expect(assinatura.status).toBe("trialing");

    const [evento] = await db
      .select()
      .from(s.subscriptionEvents)
      .where(eq(s.subscriptionEvents.organizationId, resultado.organizationId));
    expect(evento.kind).toBe("trial_started");
    expect(evento.mrrAfterCents).toBe(0);
  });

  it("recusa e-mail já cadastrado sem criar conta nem sessão", async () => {
    await db.insert(s.users).values({
      name: "Dona de outra clínica",
      email: EMAIL_EXISTENTE,
      passwordHash: "hash-de-verdade-de-outra-pessoa",
    });

    const antes = await inventario();
    const resultado = await signUp(entrada({ ip: `${IP_BASE}13`, email: EMAIL_EXISTENTE }));

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.outcome).toBe("email_taken");
    expect(resultado.field).toBe("email");
    // A mensagem manda entrar ou recuperar a senha sem confirmar cadastro alheio.
    expect(resultado.error).toMatch(/entre|recupere/i);

    const depois = await inventario();
    expect(depois).toEqual(antes);

    const [usuario] = await db
      .select()
      .from(s.users)
      .where(eq(s.users.email, EMAIL_EXISTENTE));
    // A senha de quem já existia continua intacta: adotar o login era o vetor.
    expect(usuario.passwordHash).toBe("hash-de-verdade-de-outra-pessoa");

    const sessoes = await db
      .select()
      .from(s.sessions)
      .where(eq(s.sessions.userId, usuario.id));
    expect(sessoes).toHaveLength(0);
  });

  it("recusa nome de clínica que viraria endereço reservado", async () => {
    const antes = await inventario();
    const resultado = await signUp(
      entrada({ ip: `${IP_BASE}14`, clinicName: "Admin", email: `admin-${SUFIXO}@example.test` }),
    );

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.outcome).toBe("reserved_slug");
    expect(espiaoHash).not.toHaveBeenCalled();
    expect(await inventario()).toEqual(antes);
  });

  it("o limite por IP recusa antes de gastar bcrypt", async () => {
    const ip = `${IP_BASE}15`;
    await db.insert(s.signupAttempts).values(
      Array.from({ length: 5 }, () => ({ ip, email: EMAIL_NOVO, outcome: "created" })),
    );

    const antes = await inventario();
    const resultado = await signUp(entrada({ ip, email: `limite-${SUFIXO}@example.test` }));

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.outcome).toBe("rate_limited");
    expect(espiaoHash).not.toHaveBeenCalled();
    expect(await inventario()).toEqual(antes);

    // A recusa por limite não conta na janela: se contasse, insistir prorrogaria
    // o próprio bloqueio para sempre. Por isso ela nem chega a ser gravada —
    // gravar devolveria a quem já foi barrado uma escrita por requisição.
    const registradas = await db
      .select()
      .from(s.signupAttempts)
      .where(
        and(
          eq(s.signupAttempts.ip, ip),
          gte(s.signupAttempts.createdAt, new Date(Date.now() - 60_000)),
        ),
      );
    expect(registradas).toHaveLength(5);
    expect(registradas.some((r) => r.outcome === "rate_limited")).toBe(false);
  });

  /**
   * Regressão do defeito que derrubava o funil inteiro.
   *
   * Com as armadilhas na frente do portão, um POST com o campo-isca preenchido
   * nunca consultava o limite: um único endereço gravava sessenta linhas em
   * segundos e o teto da plataforma recusava o cadastro de TODA clínica pela
   * hora seguinte, sem gastar um bcrypt. Custo do ataque: sessenta requisições
   * de curl.
   */
  it("robô insistente não gasta o orçamento de cadastro das clínicas de verdade", async () => {
    const ipRobo = `${IP_BASE}20`;
    const ipClinica = `${IP_BASE}21`;

    for (let i = 0; i < 12; i += 1) {
      const r = await signUp(
        entrada({ ip: ipRobo, honeypot: "spam", email: `robo${i}-${SUFIXO}@example.test` }),
      );
      expect(r.ok).toBe(false);
    }

    // O portão corta o mesmo endereço no sexto POST, mesmo quando a recusa vem
    // da armadilha: ninguém escreve no banco à vontade por causa dela.
    const doRobo = await db
      .select()
      .from(s.signupAttempts)
      .where(eq(s.signupAttempts.ip, ipRobo));
    expect(doRobo.length).toBeLessThanOrEqual(SIGNUP_MAX_PER_IP_PER_HOUR);

    // E o teto da plataforma ignora robô já identificado: mesmo com a tabela
    // cheia de armadilhas, a clínica seguinte entra.
    await db.insert(s.signupAttempts).values(
      Array.from({ length: SIGNUP_MAX_PER_HOUR + 10 }, (_, i) => ({
        ip: `${IP_BASE}${100 + (i % 50)}`,
        email: `enchendo${i}-${SUFIXO}@example.test`,
        outcome: i % 2 === 0 ? "honeypot" : "too_fast",
      })),
    );

    const clinica = await signUp(
      entrada({ ip: ipClinica, email: `legitima-${SUFIXO}@example.test` }),
    );
    expect(clinica.ok).toBe(true);
  });

  it("recusa a armadilha e o preenchimento instantâneo sem tocar no bcrypt", async () => {
    const antes = await inventario();

    const robo = await signUp(
      entrada({ ip: `${IP_BASE}16`, honeypot: "http://spam.example", email: `bot-${SUFIXO}@example.test` }),
    );
    expect(robo.ok).toBe(false);
    if (!robo.ok) expect(robo.outcome).toBe("honeypot");

    const instantaneo = await signUp(
      entrada({ ip: `${IP_BASE}17`, formIssuedAtMs: Date.now(), email: `rapido-${SUFIXO}@example.test` }),
    );
    expect(instantaneo.ok).toBe(false);
    if (!instantaneo.ok) expect(instantaneo.outcome).toBe("too_fast");

    // POST direto, sem o carimbo do servidor: também é robô.
    const semCarimbo = await signUp(
      entrada({ ip: `${IP_BASE}18`, formIssuedAtMs: 0, email: `sem-${SUFIXO}@example.test` }),
    );
    expect(semCarimbo.ok).toBe(false);
    if (!semCarimbo.ok) expect(semCarimbo.outcome).toBe("too_fast");

    expect(espiaoHash).not.toHaveBeenCalled();
    expect(await inventario()).toEqual(antes);
  });

  it("recusa plano fora da vitrine", async () => {
    await db.update(s.plans).set({ publicVisible: false }).where(eq(s.plans.id, planoId));
    try {
      const antes = await inventario();
      const resultado = await signUp(
        entrada({ ip: `${IP_BASE}19`, email: `vitrine-${SUFIXO}@example.test` }),
      );
      expect(resultado.ok).toBe(false);
      if (!resultado.ok) expect(resultado.outcome).toBe("invalid_plan");
      expect(espiaoHash).not.toHaveBeenCalled();
      expect(await inventario()).toEqual(antes);
    } finally {
      await db.update(s.plans).set({ publicVisible: true }).where(eq(s.plans.id, planoId));
    }
  });
});
