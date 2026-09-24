import "server-only";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { asaasAccounts, organizations } from "@/db/schema";
import type { TenantContext } from "@/server/auth";
import {
  ambienteDaChave,
  contaDoAsaas,
  mascararChave,
  registrarWebhook,
  removerWebhook,
} from "@/server/payments/asaas";
import { publicBaseUrl } from "@/server/services/whatsapp-connection-service";

/**
 * A conexão de cada clínica com o Asaas dela.
 *
 * Aqui não existe conta da plataforma: quem conecta é a dona, com a chave
 * dela, e o dinheiro vai direto para ela. A plataforma nunca aparece como
 * intermediária, nunca retém valor e nunca precisa de repasse.
 */

export type ContaAsaasNaTela = {
  ambiente: "producao" | "sandbox";
  nomeDaConta: string | null;
  emailDaConta: string | null;
  chaveMascarada: string;
  /** URL do nosso webhook, mostrada só quando a clínica precisa colar à mão. */
  webhookUrl: string;
  webhookAutomatico: boolean;
  status: "conectada" | "com_erro";
  statusDetail: string | null;
  conferidaEm: Date | null;
};

export type RegraDeCobranca = {
  exigirPagamento: boolean;
  percentual: number;
  minutosDeReserva: number;
};

export function urlDoWebhook(token: string): string {
  const base = publicBaseUrl();
  return `${base || ""}/api/webhooks/asaas/${token}`;
}

function paraTela(linha: typeof asaasAccounts.$inferSelect): ContaAsaasNaTela {
  return {
    ambiente: linha.environment,
    nomeDaConta: linha.accountName,
    emailDaConta: linha.accountEmail,
    chaveMascarada: mascararChave(linha.apiKey),
    webhookUrl: urlDoWebhook(linha.webhookToken),
    webhookAutomatico: Boolean(linha.asaasWebhookId),
    status: linha.status,
    statusDetail: linha.statusDetail,
    conferidaEm: linha.lastCheckedAt,
  };
}

export async function contaDaClinica(organizationId: number): Promise<ContaAsaasNaTela | null> {
  const [linha] = await db
    .select()
    .from(asaasAccounts)
    .where(eq(asaasAccounts.organizationId, organizationId))
    .limit(1);
  return linha ? paraTela(linha) : null;
}

/** A linha crua, para quem vai falar com o Asaas. Nunca vai para a tela. */
export async function credencialDaClinica(organizationId: number) {
  const [linha] = await db
    .select()
    .from(asaasAccounts)
    .where(eq(asaasAccounts.organizationId, organizationId))
    .limit(1);
  return linha ?? null;
}

/**
 * Conecta a conta do Asaas da clínica.
 *
 * A chave é conferida ANTES de ser gravada: chave errada é o erro mais comum, e
 * descobrir isso só quando a primeira cliente tenta pagar custa uma venda.
 * Reconectar com chave nova troca a chave e reaponta o webhook, sem perder o
 * segredo da URL que já está registrado do lado do Asaas.
 */
export async function conectarAsaas(ctx: TenantContext, chaveCrua: string): Promise<ContaAsaasNaTela> {
  const chave = chaveCrua.trim();
  if (!chave.startsWith("$aact_")) {
    throw new Error("Essa não parece uma chave do Asaas. Ela começa com $aact_ e vem em Integrações, no painel do Asaas.");
  }
  if (!publicBaseUrl()) {
    throw new Error("Falta configurar o endereço público do sistema antes de conectar o Asaas.");
  }

  // Confere de quem é a chave. Se o Asaas recusar, nada é gravado.
  const conta = await contaDoAsaas(chave);

  const existente = await credencialDaClinica(ctx.organizationId);
  const webhookToken = existente?.webhookToken ?? randomBytes(24).toString("hex");
  const registro = await registrarWebhook(chave, {
    url: urlDoWebhook(webhookToken),
    authToken: webhookToken,
    email: conta.email,
  });

  const valores = {
    organizationId: ctx.organizationId,
    apiKey: chave,
    environment: ambienteDaChave(chave),
    accountName: conta.nome,
    accountEmail: conta.email,
    webhookToken,
    asaasWebhookId: registro.id ?? existente?.asaasWebhookId ?? null,
    status: "conectada" as const,
    statusDetail: registro.automatico
      ? null
      : "Não consegui criar o aviso de pagamento automaticamente nesta conta. Cole a URL abaixo no painel do Asaas.",
    lastCheckedAt: new Date(),
    updatedAt: new Date(),
  };

  const [linha] = existente
    ? await db.update(asaasAccounts).set(valores).where(eq(asaasAccounts.id, existente.id)).returning()
    : await db.insert(asaasAccounts).values(valores).returning();

  return paraTela(linha);
}

/**
 * Desconecta, e desliga a exigência junto.
 *
 * Deixar "exigir pagamento" ligado sem conta conectada trancaria o
 * agendamento online inteiro: a cliente escolheria o horário e não teria como
 * pagar. Desligar as duas coisas na mesma transação é o que impede a clínica
 * de sair daqui com a agenda pública quebrada.
 */
export async function desconectarAsaas(ctx: TenantContext): Promise<void> {
  const existente = await credencialDaClinica(ctx.organizationId);
  if (!existente) return;

  if (existente.asaasWebhookId) {
    await removerWebhook(existente.apiKey, existente.asaasWebhookId);
  }

  await db.transaction(async (tx) => {
    await tx.delete(asaasAccounts).where(eq(asaasAccounts.id, existente.id));
    await tx
      .update(organizations)
      .set({ requirePaymentToBook: false })
      .where(eq(organizations.id, ctx.organizationId));
  });
}

export async function regraDeCobranca(organizationId: number): Promise<RegraDeCobranca> {
  const [linha] = await db
    .select({
      exigirPagamento: organizations.requirePaymentToBook,
      percentual: organizations.paymentDepositPercent,
      minutosDeReserva: organizations.paymentHoldMinutes,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return linha ?? { exigirPagamento: false, percentual: 50, minutosDeReserva: 30 };
}

/**
 * A clínica exige pagamento E tem conta conectada para receber?
 *
 * Mora aqui, e não no serviço de cobrança, porque quem pergunta isso antes de
 * montar o prompt do agente não pode arrastar junto o módulo que importa o
 * orquestrador: seria um ciclo de módulos, e ciclo em ESM é `undefined` em
 * tempo de carga, não erro de compilação.
 */
export async function cobrancaExigida(organizationId: number): Promise<boolean> {
  const regra = await regraDeCobranca(organizationId);
  if (!regra.exigirPagamento) return false;
  // Exigir sem conta conectada trancaria a agenda: quem não tem como receber
  // não pode ter como cobrar.
  return (await credencialDaClinica(organizationId)) !== null;
}

export async function salvarRegraDeCobranca(ctx: TenantContext, regra: RegraDeCobranca): Promise<void> {
  const percentual = Math.max(10, Math.min(100, Math.round(regra.percentual)));
  const minutos = Math.max(10, Math.min(1440, Math.round(regra.minutosDeReserva)));

  if (regra.exigirPagamento) {
    // Ligar a exigência sem conta conectada trancaria a agenda pública.
    const conta = await credencialDaClinica(ctx.organizationId);
    if (!conta) throw new Error("Conecte a conta do Asaas antes de exigir pagamento no agendamento.");
  }

  await db
    .update(organizations)
    .set({
      requirePaymentToBook: regra.exigirPagamento,
      paymentDepositPercent: percentual,
      paymentHoldMinutes: minutos,
    })
    .where(eq(organizations.id, ctx.organizationId));
}
