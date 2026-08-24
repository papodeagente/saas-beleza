import "server-only";
import { addDays, addMonths, addYears } from "date-fns";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { generateAccountCode } from "@/lib/account-code";
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
 * Cadastro de uma clínica real — pelo painel da plataforma OU pelo autocadastro
 * público.
 *
 * "Entrar" significa a mesma coisa nos dois caminhos: a clínica nasce utilizável
 * (tem unidade), com um responsável que consegue entrar (tem senha) e com a
 * receita já contabilizada (tem assinatura E o evento correspondente).
 *
 * Tudo numa transação só. Meia conta criada é pior que nenhuma: ficaria
 * ocupando o slug, invisível na lista de pagantes e sem ninguém que consiga
 * entrar nela.
 *
 * O QUE MUDA ENTRE OS DOIS CAMINHOS está inteiro no ator, nunca em booleano
 * solto de parâmetro. Ver `CreateAccountActor`.
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

/**
 * Quem está criando a conta. É o ator que decide a autoria do evento de receita
 * e o que pode ser feito com um e-mail já cadastrado — os dois nunca podem ser
 * escolhidos por quem chama.
 *
 * Adotar um usuário existente pelo e-mail é correto no painel: quem opera a
 * plataforma já provou quem é, e a dona de duas clínicas não deve ter dois
 * logins. No autocadastro seria TOMADA DE CONTA: a rota termina em
 * `createSession(ownerUserId)`, então digitar o e-mail de uma cliente
 * qualquer entregaria uma sessão como ela, sem nunca provar a senha.
 */
export type CreateAccountActor =
  | { kind: "platform_admin"; ctx: PlatformContext }
  | { kind: "self_signup" };

export type CreateAccountInput = {
  clinicName: string;
  timezone: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
  /** WhatsApp de quem assina, só dígitos. O painel não coleta; o site, sim. */
  ownerPhone?: string | null;
  planId: number;
  cycle: "monthly" | "yearly";
  /** `trial` começa no período de testes do plano; `active` já entra pagando. */
  start: "trial" | "active";
};

export type CreateAccountResult = {
  organizationId: number;
  slug: string;
  /** Código da conta, para o operador já passar ao cliente. */
  publicId: string;
  /** Quem responde pela conta. O autocadastro abre a sessão com este id. */
  ownerUserId: number;
  ownerReused: boolean;
  trialEndsAt: Date | null;
};

/**
 * Slug legível a partir do nome. `demo-` é reservado: foi o prefixo dos dados
 * de demonstração, e uma conta real não pode herdar essa marca.
 *
 * Exportado porque o autocadastro precisa recusar o slug ANTES de criar
 * qualquer linha — e para isso ele tem que derivar exatamente o mesmo texto que
 * seria gravado aqui. Duas derivações separadas divergiriam no primeiro acento.
 */
export function slugFromClinicName(name: string): string {
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
  actor: CreateAccountActor,
  input: CreateAccountInput,
): Promise<CreateAccountResult> {
  const clinicName = input.clinicName.trim();
  const ownerName = input.ownerName.trim();
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  const allowExistingOwner = actor.kind === "platform_admin";

  return db.transaction(async (tx) => {
    const [plan] = await tx.select().from(plans).where(eq(plans.id, input.planId)).limit(1);
    if (!plan) throw new CreateAccountError("Plano não encontrado.", "PLAN_NOT_FOUND");

    // O e-mail é decidido ANTES de qualquer escrita e antes do bcrypt: no
    // autocadastro isto é uma recusa, e recusar depois de gastar ~250ms de CPU
    // por tentativa transforma a rota pública em amplificador de carga.
    const [existente] = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.email, ownerEmail))
      .limit(1);

    if (existente && !allowExistingOwner) {
      throw new CreateAccountError(
        "Este e-mail já tem cadastro. Entre com ele ou recupere a senha.",
        "EMAIL_TAKEN",
      );
    }

    // Slug único sem corrida: tenta o preferido e vai numerando. O UNIQUE do
    // banco continua sendo a autoridade — isto só escolhe um nome bonito.
    const preferido = slugFromClinicName(clinicName);
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

    /**
     * Código da conta.
     *
     * O insert mira o conflito no próprio código e não aborta a transação
     * quando ele acontece: no Postgres, um erro de unicidade invalidaria tudo
     * que já foi escrito aqui, e não haveria como tentar de novo lá dentro.
     * Com `on conflict do nothing`, o insert simplesmente não devolve linha, e
     * o laço tenta outro código.
     *
     * Conferir antes com um SELECT não resolveria: entre a consulta e a
     * escrita cabe outra transação gravando o mesmo valor. Quem decide é o
     * índice único.
     *
     * Cinco tentativas: com 32^8 possibilidades, falhar cinco vezes seguidas
     * deixou de ser azar e virou defeito — melhor falhar visível.
     */
    let organization: typeof organizations.$inferSelect | undefined;
    for (let tentativa = 0; tentativa < 5 && !organization; tentativa += 1) {
      [organization] = await tx
        .insert(organizations)
        .values({ name: clinicName, slug, publicId: generateAccountCode(), timezone: input.timezone })
        .onConflictDoNothing({ target: organizations.publicId })
        .returning();
    }
    if (!organization) {
      throw new CreateAccountError(
        "Não consegui gerar um código para a conta. Tente de novo.",
        "ACCOUNT_CODE_EXHAUSTED",
      );
    }

    // Pelo painel, e-mail conhecido vincula o login existente (dona de duas
    // clínicas) em vez de recusar o cadastro. Nada do cadastro antigo é
    // sobrescrito — nem senha, nem nome, nem telefone: cadastrar uma clínica
    // nova não pode derrubar nem alterar o acesso que ela já tinha em outra.
    let ownerId: number;
    if (existente) {
      ownerId = existente.id;
    } else {
      const [novo] = await tx
        .insert(users)
        .values({
          name: ownerName,
          email: ownerEmail,
          phone: input.ownerPhone?.trim() || null,
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

    // Autoria do evento sai do ator, nunca de parâmetro: nenhuma origem pode
    // assinar como se fosse outra, e o histórico da conta precisa dizer a
    // verdade sobre quem a criou anos depois.
    const sufixoTeste = emTeste ? ` — teste de ${plan.trialDays} dias` : "";
    const autoria =
      actor.kind === "platform_admin"
        ? {
            source: "platform_admin",
            note: `Conta cadastrada por ${actor.ctx.userName}${sufixoTeste}.`,
            payload: { actorUserId: actor.ctx.userId, actorEmail: actor.ctx.userEmail },
          }
        : {
            source: "self_signup",
            note: `Cadastro feito pela própria clínica no site${sufixoTeste}.`,
            payload: { selfSignup: true },
          };

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
      source: autoria.source,
      note: autoria.note,
      payload: autoria.payload,
      occurredAt: now,
    });

    return {
      organizationId: organization.id,
      slug,
      publicId: organization.publicId,
      ownerUserId: ownerId,
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
