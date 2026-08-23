import "server-only";
import { addDays, addMonths, addYears } from "date-fns";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  branches,
  organizationMembers,
  organizations,
  plans,
  subscriptionEvents,
  subscriptions,
  users,
} from "@/db/schema";
import { hashPassword } from "@/server/auth";
import type { PlatformContext } from "@/server/platform-auth";

/**
 * Cadastro de uma clínica real pela plataforma.
 *
 * Enquanto não existe autocadastro, é por aqui que uma conta entra — então
 * "entrar" precisa significar a mesma coisa que significaria num signup: a
 * clínica nasce utilizável (tem unidade), com um responsável que consegue
 * entrar (tem senha) e com a receita já contabilizada (tem assinatura E o
 * evento correspondente).
 *
 * Tudo numa transação só. Meia conta criada é pior que nenhuma: ficaria
 * ocupando o slug, invisível na lista de pagantes e sem ninguém que consiga
 * entrar nela.
 */

export class CreateAccountError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "CreateAccountError";
  }
}

export type CreateAccountInput = {
  clinicName: string;
  timezone: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
  planId: number;
  cycle: "monthly" | "yearly";
  /** `trial` começa no período de testes do plano; `active` já entra pagando. */
  start: "trial" | "active";
};

export type CreateAccountResult = {
  organizationId: number;
  slug: string;
  ownerReused: boolean;
  trialEndsAt: Date | null;
};

/**
 * Slug legível a partir do nome. `demo-` é reservado: foi o prefixo dos dados
 * de demonstração, e uma conta real não pode herdar essa marca.
 */
function slugify(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const limpo = base.replace(/^demo-+/, "");
  return limpo.length >= 2 ? limpo : "clinica";
}

function periodEnd(from: Date, cycle: "monthly" | "yearly"): Date {
  return cycle === "yearly" ? addYears(from, 1) : addMonths(from, 1);
}

export async function createAccount(
  ctx: PlatformContext,
  input: CreateAccountInput,
): Promise<CreateAccountResult> {
  const clinicName = input.clinicName.trim();
  const ownerName = input.ownerName.trim();
  const ownerEmail = input.ownerEmail.trim().toLowerCase();

  return db.transaction(async (tx) => {
    const [plan] = await tx.select().from(plans).where(eq(plans.id, input.planId)).limit(1);
    if (!plan) throw new CreateAccountError("Plano não encontrado.", "PLAN_NOT_FOUND");

    // Slug único sem corrida: tenta o preferido e vai numerando. O UNIQUE do
    // banco continua sendo a autoridade — isto só escolhe um nome bonito.
    const preferido = slugify(clinicName);
    let slug = preferido;
    for (let i = 2; i < 200; i += 1) {
      const [ocupado] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.slug, slug))
        .limit(1);
      if (!ocupado) break;
      slug = `${preferido}-${i}`;
    }

    const [organization] = await tx
      .insert(organizations)
      .values({ name: clinicName, slug, timezone: input.timezone })
      .returning();

    // Se a pessoa já tem login (dona de duas clínicas, por exemplo), vinculamos
    // o usuário existente em vez de recusar o cadastro. A senha dela NÃO é
    // trocada: cadastrar uma clínica nova não pode derrubar o acesso que ela já
    // tinha em outra.
    const [existente] = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.email, ownerEmail))
      .limit(1);

    let ownerId: number;
    if (existente) {
      ownerId = existente.id;
    } else {
      const [novo] = await tx
        .insert(users)
        .values({
          name: ownerName,
          email: ownerEmail,
          passwordHash: await hashPassword(input.ownerPassword),
        })
        .returning({ id: users.id });
      ownerId = novo.id;
    }

    await tx
      .insert(organizationMembers)
      .values({ organizationId: organization.id, userId: ownerId, role: "owner" });

    // Sem unidade a agenda não abre. A clínica renomeia depois; o que não pode
    // é a primeira tela do produto estar quebrada no primeiro login.
    await tx
      .insert(branches)
      .values({ organizationId: organization.id, name: clinicName });

    const now = new Date();
    const priceCents = input.cycle === "yearly" ? plan.yearlyPriceCents : plan.monthlyPriceCents;
    const emTeste = input.start === "trial";
    const trialEndsAt = emTeste ? addDays(now, plan.trialDays) : null;

    // Teste não é receita: entra com MRR zero e só vira dinheiro na conversão.
    const mrrAfter = emTeste
      ? 0
      : input.cycle === "yearly"
        ? Math.round(priceCents / 12)
        : priceCents;

    const [subscription] = await tx
      .insert(subscriptions)
      .values({
        organizationId: organization.id,
        planId: plan.id,
        status: emTeste ? "trialing" : "active",
        cycle: input.cycle,
        priceCents,
        trialEndsAt,
        startedAt: emTeste ? null : now,
        currentPeriodStart: emTeste ? null : now,
        currentPeriodEnd: emTeste ? trialEndsAt : periodEnd(now, input.cycle),
      })
      .returning({ id: subscriptions.id });

    // O gráfico de MRR é reconstruído a partir dos eventos, não do estado das
    // assinaturas. Criar uma sem o evento faria o mês não fechar.
    await tx.insert(subscriptionEvents).values({
      organizationId: organization.id,
      subscriptionId: subscription.id,
      kind: emTeste ? "trial_started" : "created",
      mrrBeforeCents: 0,
      mrrAfterCents: mrrAfter,
      planIdBefore: null,
      planIdAfter: plan.id,
      source: "platform_admin",
      note: `Conta cadastrada por ${ctx.userName}${emTeste ? ` — teste de ${plan.trialDays} dias` : ""}.`,
      payload: { actorUserId: ctx.userId, actorEmail: ctx.userEmail },
      occurredAt: now,
    });

    return {
      organizationId: organization.id,
      slug,
      ownerReused: Boolean(existente),
      trialEndsAt,
    };
  });
}

/** Planos disponíveis para cadastrar uma conta, na ordem em que são exibidos. */
export async function listPlansForNewAccount() {
  return db
    .select({
      id: plans.id,
      name: plans.name,
      description: plans.description,
      monthlyPriceCents: plans.monthlyPriceCents,
      yearlyPriceCents: plans.yearlyPriceCents,
      trialDays: plans.trialDays,
    })
    .from(plans)
    .where(eq(plans.active, true))
    .orderBy(plans.position, plans.id);
}

/** Quantas contas existem — usado para decidir entre painel e primeiro passo. */
export async function countAccounts(): Promise<{ organizations: number; subscriptions: number }> {
  const { rows } = await db.execute<{ orgs: number; subs: number }>(sql`
    select
      (select count(*) from organizations)::int as orgs,
      (select count(*) from subscriptions)::int as subs
  `);
  const r = (rows as Array<{ orgs: number; subs: number }>)[0];
  return { organizations: r.orgs, subscriptions: r.subs };
}
