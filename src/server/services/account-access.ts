import "server-only";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { organizations, platformAdmins, plans, subscriptions } from "@/db/schema";

/**
 * O portão do produto: quem pode entrar na clínica hoje.
 *
 * Existe porque teste grátis sem cartão só é um teste se ele TERMINA. Sem esta
 * checagem, o cadastro público entrega o produto de graça para sempre e o
 * painel da plataforma mente ao dizer que uma conta suspensa perdeu o acesso.
 *
 * A regra é conservadora de propósito: só bloqueia em estado NEGATIVO explícito.
 *  - suspensa pela plataforma (inadimplência, abuso) → bloqueia
 *  - teste vencido → bloqueia
 *  - cancelada e o período pago já terminou → bloqueia
 *
 * O que NÃO bloqueia, e por quê:
 *  - `past_due`: cobrança falhou, mas a clínica é cliente pagante. Cortar o
 *    acesso no primeiro boleto atrasado perde cliente que ia pagar. O painel
 *    já conta past_due como receita — os dois lados precisam concordar.
 *  - conta sem nenhuma assinatura: é conta gerida na mão (fundador, parceiro,
 *    demonstração). Ausência de assinatura não é um estado negativo.
 */

export type AccountAccess =
  | { allowed: true }
  | { allowed: false; reason: "suspended"; suspendedReason: string | null }
  | { allowed: false; reason: "trial_expired"; endedAt: Date; planName: string | null }
  | { allowed: false; reason: "canceled"; endedAt: Date | null; planName: string | null };

/**
 * `cache` porque a mesma requisição pergunta isto mais de uma vez: o layout de
 * (app) para decidir se renderiza, e `requireSession()` dentro da página ou da
 * action. Sem a memória de requisição seriam duas consultas idênticas em toda
 * navegação do painel. Fora de uma requisição do React (script, teste) o
 * `cache` simplesmente chama a função — não há estado global escondido aqui.
 */
export const getAccountAccess = cache(async function getAccountAccess(
  organizationId: number,
): Promise<AccountAccess> {
  const [row] = await db
    .select({
      suspendedAt: organizations.suspendedAt,
      suspendedReason: organizations.suspendedReason,
      status: subscriptions.status,
      trialEndsAt: subscriptions.trialEndsAt,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      canceledAt: subscriptions.canceledAt,
      planName: plans.name,
    })
    .from(organizations)
    .leftJoin(subscriptions, eq(subscriptions.organizationId, organizations.id))
    .leftJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(organizations.id, organizationId))
    .limit(1);

  if (!row) return { allowed: true };

  if (row.suspendedAt) {
    return { allowed: false, reason: "suspended", suspendedReason: row.suspendedReason };
  }

  const agora = new Date();

  if (row.status === "trialing" && row.trialEndsAt && row.trialEndsAt <= agora) {
    return {
      allowed: false,
      reason: "trial_expired",
      endedAt: row.trialEndsAt,
      planName: row.planName,
    };
  }

  // Cancelamento respeita o período já pago: quem cancelou no dia 3 de um mês
  // pago até o dia 30 continua entrando até o dia 30. Cortar antes é cobrar por
  // um serviço que não foi prestado.
  if (row.status === "canceled") {
    const fim = row.currentPeriodEnd ?? row.canceledAt;
    if (!fim || fim <= agora) {
      return { allowed: false, reason: "canceled", endedAt: fim, planName: row.planName };
    }
  }

  return { allowed: true };
});

/**
 * O mesmo portão, do ponto de vista de QUEM está entrando.
 *
 * Administrador da plataforma não é barrado. Duas razões, e as duas
 * apareceram na prática:
 *
 * 1. O dono do produto perdeu o próprio painel quando o teste da conta dele
 *    venceu (06/09/2026, conta ENTUR). Cobrança é regra para CLIENTE; aplicá-la
 *    a quem opera o SaaS é defeito, não disciplina.
 * 2. Suporte: a conta suspensa é justamente a que precisa ser aberta para se
 *    descobrir por que está suspensa. Sem esta exceção, o único caminho para
 *    diagnosticar é mexer no banco à mão.
 *
 * A exceção é da PESSOA, não da conta: a clínica bloqueada continua bloqueada
 * para a equipe dela, e `/agendar/[slug]` segue fora do ar, porque lá quem
 * decide é o estado comercial da conta e não quem está olhando.
 *
 * A consulta a `platform_admins` é feita aqui, com drizzle, em vez de importar
 * `isPlatformAdmin` de `platform-auth`: aquele módulo importa `@/server/auth`,
 * que importa este — e ciclo de import é armadilha que só aparece em runtime.
 */
export const getAccessForUser = cache(async function getAccessForUser(
  organizationId: number,
  userId: number,
): Promise<AccountAccess> {
  const acesso = await getAccountAccess(organizationId);
  if (acesso.allowed || !userId) return acesso;

  const [admin] = await db
    .select({ userId: platformAdmins.userId })
    .from(platformAdmins)
    .where(eq(platformAdmins.userId, userId))
    .limit(1);

  return admin ? { allowed: true } : acesso;
});
