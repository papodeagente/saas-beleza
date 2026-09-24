import "server-only";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { appointments, customers, organizations, payments, services } from "@/db/schema";
import { MINIMO_ASAAS_CENTS, valorDaReserva } from "@/domain/booking-payment";
import { formatBRL } from "@/lib/money";
import { formatTz } from "@/lib/tz";
import { changeStatus } from "@/server/services/appointment-service";
import { dispatchAppointmentCreatedAutomations } from "@/server/services/automation-service";
import {
  credencialDaClinica,
  regraDeCobranca,
} from "@/server/services/asaas-account-service";
import { criarLinkDePagamento, desativarLink } from "@/server/payments/asaas";
import { systemContext } from "@/server/ai/orchestrator";

export { MINIMO_ASAAS_CENTS, valorDaReserva };

/**
 * Pagamento antes de agendar.
 *
 * Vale só para o agendamento ONLINE: página pública e agente de IA. Quem marca
 * pelo balcão continua marcando sem cobrança, porque ali o acerto é olho no
 * olho e travar isso atrapalharia o trabalho da recepção.
 *
 * A reserva nasce OCUPANDO o horário, com prazo. As alternativas eram piores:
 * não ocupar deixa duas clientes pagarem pelo mesmo horário, e cobrar antes de
 * reservar faz a cliente pagar por um horário que pode não existir mais quando
 * o pagamento cair.
 */


export type CobrancaAberta = {
  url: string;
  valorCents: number;
  venceEm: Date;
};

/**
 * Abre a cobrança de uma reserva que já existe.
 *
 * Roda depois do agendamento criado, nunca antes: é o agendamento que segura o
 * horário. Se o Asaas falhar aqui, quem chamou decide o que fazer com a
 * reserva; este módulo não desfaz agenda por conta própria.
 *
 * Devolve `null` quando o serviço é mais barato que o mínimo do Asaas: nesse
 * caso o agendamento vale como qualquer outro, sem cobrança. A alternativa era
 * recusar o agendamento de um serviço de R$ 3,00 por causa de uma regra de
 * cobrança — tirar da agenda uma venda que a clínica queria fazer.
 */
export async function abrirCobranca(
  organizationId: number,
  appointmentId: number,
): Promise<CobrancaAberta | null> {
  const conta = await credencialDaClinica(organizationId);
  if (!conta) throw new Error("Esta clínica não tem conta do Asaas conectada.");

  const regra = await regraDeCobranca(organizationId);

  const [reserva] = await db
    .select({
      id: appointments.id,
      startsAt: appointments.startsAt,
      priceCents: appointments.priceCents,
      servico: services.name,
      cliente: customers.name,
      clinica: organizations.name,
      fuso: organizations.timezone,
    })
    .from(appointments)
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .innerJoin(organizations, eq(organizations.id, appointments.organizationId))
    .where(and(eq(appointments.id, appointmentId), eq(appointments.organizationId, organizationId)))
    .limit(1);
  if (!reserva) throw new Error("Agendamento não encontrado.");

  const valorCents = valorDaReserva(reserva.priceCents, regra.percentual);
  if (valorCents < MINIMO_ASAAS_CENTS) return null;

  const venceEm = new Date(Date.now() + regra.minutosDeReserva * 60_000);
  const quando = formatTz(reserva.startsAt, reserva.fuso, "dd/MM 'às' HH:mm");

  const link = await criarLinkDePagamento(conta.apiKey, {
    nome: `${reserva.servico} ${quando}`,
    // A descrição é o que a cliente lê na tela do Asaas. Ela precisa
    // reconhecer o que está pagando sem abrir o WhatsApp de novo.
    descricao:
      regra.percentual >= 100
        ? `${reserva.servico} em ${reserva.clinica}, ${quando}. Pagamento do atendimento.`
        : `${reserva.servico} em ${reserva.clinica}, ${quando}. Sinal de ${regra.percentual}% para garantir o horário; o restante é pago no dia.`,
    valorCents,
    expiraEm: venceEm,
  });

  await db
    .update(appointments)
    .set({
      paymentStatus: "aguardando",
      paymentAmountCents: valorCents,
      paymentUrl: link.url,
      asaasPaymentLinkId: link.id,
      paymentDueAt: venceEm,
      updatedAt: new Date(),
    })
    .where(eq(appointments.id, appointmentId));

  return { url: link.url, valorCents, venceEm };
}

/** Texto pronto para mandar à cliente. Usado pelo agente e pela página pública. */
export function recadoDaCobranca(cobranca: CobrancaAberta, minutos: number): string {
  return `Para garantir o horário, o pagamento de ${formatBRL(cobranca.valorCents)} precisa ser feito em até ${minutos} minutos: ${cobranca.url}`;
}

/**
 * O que fazer com um evento do Asaas.
 *
 * Função pura, e exportada, porque é a regra mais fácil de errar da
 * integração: `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED` são o MESMO pagamento
 * chegando duas vezes (confirmado e liquidado), e `PAYMENT_OVERDUE` não é
 * cancelamento — o vencimento do boleto do Asaas é muito mais longo que o
 * nosso prazo de reserva, então tratá-lo como queda derrubaria horário que
 * ainda podia ser pago.
 */
export function decisaoDoEvento(evento: string): "confirmar" | "estornar" | "ignorar" {
  switch (evento) {
    case "PAYMENT_CONFIRMED":
    case "PAYMENT_RECEIVED":
      return "confirmar";
    case "PAYMENT_REFUNDED":
    case "PAYMENT_CHARGEBACK_REQUESTED":
    case "PAYMENT_CHARGEBACK_DISPUTE":
      return "estornar";
    default:
      return "ignorar";
  }
}

/** Asaas fala em billingType; o caixa da clínica fala em meio de pagamento. */
export function meioDePagamento(billingType: string | null): "pix" | "cartao_credito" | "cartao_debito" | "outro" {
  switch ((billingType ?? "").toUpperCase()) {
    case "PIX":
      return "pix";
    case "CREDIT_CARD":
      return "cartao_credito";
    case "DEBIT_CARD":
      return "cartao_debito";
    default:
      return "outro";
  }
}

/**
 * O pagamento caiu: confirma a reserva e registra o dinheiro.
 *
 * Idempotente de propósito. O Asaas manda `PAYMENT_CONFIRMED` e
 * `PAYMENT_RECEIVED` para a mesma cobrança, reentrega quando o nosso endpoint
 * falha, e a conciliação pode chamar isto de novo: duas confirmações não podem
 * virar dois lançamentos no caixa.
 */
export async function confirmarPagamento(
  organizationId: number,
  entrada: { linkId: string; pagamentoId: string; valorCents: number; billingType: string | null },
): Promise<{ appointmentId: number } | null> {
  const [reserva] = await db
    .select({
      id: appointments.id,
      customerId: appointments.customerId,
      paymentStatus: appointments.paymentStatus,
      status: appointments.status,
      valorCobrado: appointments.paymentAmountCents,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.organizationId, organizationId),
        eq(appointments.asaasPaymentLinkId, entrada.linkId),
      ),
    )
    .limit(1);
  if (!reserva) return null;
  if (reserva.paymentStatus === "pago") return { appointmentId: reserva.id };

  const agora = new Date();
  await db
    .update(appointments)
    .set({
      paymentStatus: "pago",
      paymentPaidAt: agora,
      asaasPaymentId: entrada.pagamentoId,
      paymentDueAt: null,
      updatedAt: agora,
    })
    .where(eq(appointments.id, reserva.id));

  // O dinheiro entra no caixa da clínica pelo mesmo lugar que um pagamento de
  // balcão entra: é o Financeiro dela que precisa bater no fim do mês.
  await db.insert(payments).values({
    organizationId,
    appointmentId: reserva.id,
    customerId: reserva.customerId,
    method: meioDePagamento(entrada.billingType),
    amountCents: entrada.valorCents || reserva.valorCobrado || 0,
    paidAt: agora,
  });

  const ctx = await systemContext(organizationId);

  /**
   * Reserva paga vira agendamento confirmado.
   *
   * Sem isso a dona abriria a agenda e veria "agendado" em cima de um horário
   * já pago, sem diferença nenhuma de quem ainda não pagou.
   */
  if (reserva.status === "scheduled") {
    await changeStatus(ctx, reserva.id, "confirmed", { actor: { type: "system" } }).catch((erro) => {
      console.warn("[asaas] pagamento confirmado sem mudar o status:", erro instanceof Error ? erro.message : erro);
    });
  }

  /**
   * A confirmação que a criação do agendamento deixou de mandar sai AGORA.
   *
   * É o momento em que ela é verdade. O livro-razão da automação dedupa por
   * regra e agendamento, então o `PAYMENT_RECEIVED` que chega depois do
   * `PAYMENT_CONFIRMED`, e qualquer reentrega do Asaas, não viram duas
   * mensagens para a mesma cliente.
   */
  await dispatchAppointmentCreatedAutomations(ctx, reserva.id).catch((erro) => {
    console.warn("[cobrança] confirmação não enviada:", erro instanceof Error ? erro.message : erro);
  });

  return { appointmentId: reserva.id };
}

/** Estorno: o horário volta a ficar sem pagamento, e a dona vê o motivo. */
export async function registrarEstorno(organizationId: number, linkId: string): Promise<void> {
  await db
    .update(appointments)
    .set({ paymentStatus: "estornado", updatedAt: new Date() })
    .where(
      and(eq(appointments.organizationId, organizationId), eq(appointments.asaasPaymentLinkId, linkId)),
    );
}

/**
 * Derruba as reservas que venceram sem pagamento.
 *
 * É esta varredura que devolve o horário para a grade. Sem ela, um carrinho
 * abandonado segura o melhor horário de sábado para sempre — e o link do Asaas
 * continuaria vivo, aceitando pagamento de um horário que a clínica já teria
 * dado para outra pessoa.
 */
export async function expirarReservasVencidas(agora = new Date()): Promise<number> {
  const vencidas = await db
    .select({
      id: appointments.id,
      organizationId: appointments.organizationId,
      linkId: appointments.asaasPaymentLinkId,
    })
    .from(appointments)
    .where(and(eq(appointments.paymentStatus, "aguardando"), lt(appointments.paymentDueAt, agora)))
    .limit(200);

  let derrubadas = 0;
  for (const reserva of vencidas) {
    try {
      const ctx = await systemContext(reserva.organizationId);
      await changeStatus(ctx, reserva.id, "cancelled", {
        cancelReason: "Pagamento não confirmado no prazo da reserva.",
        actor: { type: "system" },
      });
      await db
        .update(appointments)
        .set({ paymentStatus: "vencido", paymentUrl: null, updatedAt: new Date() })
        .where(eq(appointments.id, reserva.id));

      // Link vivo é cobrança viva: desativar evita a cliente pagar por um
      // horário que já voltou para a grade.
      const conta = await credencialDaClinica(reserva.organizationId);
      if (conta && reserva.linkId) {
        await desativarLink(conta.apiKey, reserva.linkId).catch(() => undefined);
      }
      derrubadas += 1;
    } catch (erro) {
      console.warn(
        `[cobranca] reserva ${reserva.id} não expirada:`,
        erro instanceof Error ? erro.message : erro,
      );
    }
  }
  return derrubadas;
}
