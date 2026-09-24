import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { appointments, customers, organizations, payments, services } from "@/db/schema";
import { MINIMO_ASAAS_CENTS, valorDaReserva } from "@/domain/booking-payment";
import { formatTz } from "@/lib/tz";
import { changeStatus } from "@/server/services/appointment-service";
import { dispatchAppointmentCreatedAutomations } from "@/server/services/automation-service";
import { credencialDaClinica, regraDeCobranca } from "@/server/services/asaas-account-service";
import {
  type CartaoDaCliente,
  apagarCobranca,
  buscarPagamento,
  criarCliente,
  criarCobrancaCartao,
  criarCobrancaPix,
  pixDaCobranca,
} from "@/server/payments/asaas";
import { publicBaseUrl } from "@/server/services/whatsapp-connection-service";
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
 *
 * **A cobrança no Asaas só nasce quando a cliente escolhe como pagar.** Criar
 * no momento do agendamento encheria o painel da clínica de cobrança de
 * carrinho abandonado e obrigaria a apagar cada uma na expiração. Aqui a
 * reserva nasce só com valor, prazo e token; o resto é decidido no checkout.
 */

export type ReservaAberta = {
  token: string;
  /** Endereço do nosso checkout. É o que se manda para a cliente. */
  url: string;
  valorCents: number;
  venceEm: Date;
};

/** O checkout é nosso: `/pagar/<token>`, no mesmo domínio do agendamento. */
export function urlDoCheckout(token: string): string {
  return `${publicBaseUrl() || ""}/pagar/${token}`;
}

/**
 * Marca a reserva como "aguardando pagamento" e devolve por onde pagar.
 *
 * Roda depois do agendamento criado, nunca antes: é o agendamento que segura o
 * horário. Devolve `null` quando o serviço é mais barato que o mínimo do
 * Asaas — nesse caso a reserva vale como qualquer outra, sem cobrança, porque
 * recusar o agendamento de um serviço de R$ 3,00 por causa de uma regra de
 * cobrança seria tirar da agenda uma venda que a clínica queria fazer.
 */
export async function abrirCobranca(
  organizationId: number,
  appointmentId: number,
): Promise<ReservaAberta | null> {
  const regra = await regraDeCobranca(organizationId);

  const [reserva] = await db
    .select({ priceCents: appointments.priceCents })
    .from(appointments)
    .where(and(eq(appointments.id, appointmentId), eq(appointments.organizationId, organizationId)))
    .limit(1);
  if (!reserva) throw new Error("Agendamento não encontrado.");

  const valorCents = valorDaReserva(reserva.priceCents, regra.percentual);
  if (valorCents < MINIMO_ASAAS_CENTS) return null;

  const token = randomBytes(24).toString("hex");
  const venceEm = new Date(Date.now() + regra.minutosDeReserva * 60_000);

  await db
    .update(appointments)
    .set({
      paymentStatus: "aguardando",
      paymentAmountCents: valorCents,
      paymentToken: token,
      paymentUrl: urlDoCheckout(token),
      paymentDueAt: venceEm,
      updatedAt: new Date(),
    })
    .where(eq(appointments.id, appointmentId));

  return { token, url: urlDoCheckout(token), valorCents, venceEm };
}

// ── O checkout ─────────────────────────────────────────────────────────────

/**
 * Nome da profissional e da unidade sem mais dois `innerJoin`.
 *
 * O checkout é uma tela de leitura, aberta por quem está com o celular na mão
 * esperando o PIX cair: subconsulta escalar sai mais barata que espalhar
 * junção por tabela que não filtra nada.
 */
const nomeDaProfissional = sql<string>`(select p.name from professionals p where p.id = ${appointments.professionalId})`;
const nomeDaUnidade = sql<string>`(select b.name from branches b where b.id = ${appointments.branchId})`;

export type CheckoutDaReserva = {
  clinica: string;
  /** Para o caminho de volta quando o prazo estoura. */
  slug: string;
  servico: string;
  profissional: string;
  unidade: string;
  quando: string;
  valorCents: number;
  precoCents: number;
  /** Fim do prazo, em ISO. A contagem na tela sai daqui. */
  venceEm: string | null;
  estado: "aguardando" | "pago" | "vencido" | "estornado" | "sem_cobranca";
  /** A conta da clínica tem chave PIX ativa. Sem isso, só cartão. */
  pixDisponivel: boolean;
  /** Para não pedir de novo o que a cliente já informou ao agendar. */
  cliente: { nome: string; telefone: string | null; email: string | null; cpf: string | null };
};

type LinhaDaReserva = {
  id: number;
  organizationId: number;
  customerId: number;
  status: string;
  paymentStatus: string;
  valorCents: number | null;
  precoCents: number;
  venceEm: Date | null;
  asaasPaymentId: string | null;
  startsAt: Date;
  fuso: string;
  clinica: string;
  slug: string;
  servico: string;
  profissional: string;
  unidade: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  cpf: string | null;
  asaasCustomerId: string | null;
};

async function reservaPorToken(token: string): Promise<LinhaDaReserva | null> {
  // Token curto é chute, não reserva: nem chega ao banco.
  if (!token || token.length < 20) return null;
  const [linha] = await db
    .select({
      id: appointments.id,
      organizationId: appointments.organizationId,
      customerId: appointments.customerId,
      status: appointments.status,
      paymentStatus: appointments.paymentStatus,
      valorCents: appointments.paymentAmountCents,
      precoCents: appointments.priceCents,
      venceEm: appointments.paymentDueAt,
      asaasPaymentId: appointments.asaasPaymentId,
      startsAt: appointments.startsAt,
      fuso: organizations.timezone,
      clinica: organizations.name,
      slug: organizations.slug,
      servico: services.name,
      profissional: nomeDaProfissional,
      unidade: nomeDaUnidade,
      nome: customers.name,
      telefone: customers.phone,
      email: customers.email,
      cpf: customers.document,
      asaasCustomerId: customers.asaasCustomerId,
    })
    .from(appointments)
    .innerJoin(organizations, eq(organizations.id, appointments.organizationId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .where(eq(appointments.paymentToken, token))
    .limit(1);
  return linha ?? null;
}

function estadoDaTela(status: string): CheckoutDaReserva["estado"] {
  switch (status) {
    case "aguardando":
      return "aguardando";
    case "pago":
      return "pago";
    case "vencido":
      return "vencido";
    case "estornado":
      return "estornado";
    default:
      return "sem_cobranca";
  }
}

export async function checkoutPorToken(token: string): Promise<CheckoutDaReserva | null> {
  const linha = await reservaPorToken(token);
  if (!linha) return null;

  const conta = await credencialDaClinica(linha.organizationId);
  // Prazo estourado mostra a tela do prazo estourado na hora, sem esperar a
  // varredura: quem voltou tarde não pode ver um QR que já não vale.
  const vencida =
    linha.paymentStatus === "aguardando" && linha.venceEm !== null && linha.venceEm <= new Date();

  return {
    clinica: linha.clinica,
    slug: linha.slug,
    servico: linha.servico,
    profissional: linha.profissional,
    unidade: linha.unidade,
    quando: formatTz(linha.startsAt, linha.fuso, "EEEE, d 'de' MMMM 'às' HH:mm"),
    valorCents: linha.valorCents ?? 0,
    precoCents: linha.precoCents,
    venceEm: linha.venceEm?.toISOString() ?? null,
    estado: vencida ? "vencido" : estadoDaTela(linha.paymentStatus),
    pixDisponivel: Boolean(conta?.pixReady),
    cliente: {
      nome: linha.nome,
      telefone: linha.telefone,
      email: linha.email,
      cpf: linha.cpf,
    },
  };
}

/** Erro que a cliente PODE resolver: a tela mostra a frase, sem traduzir. */
export class CheckoutError extends Error {}

/**
 * Garante que dá para cobrar esta reserva agora.
 *
 * O prazo é conferido aqui, e não só na varredura: entre um tique de 30s e
 * outro cabe uma cliente terminando de pagar um horário que já é de outra
 * pessoa. Quem chega atrasado ouve isso antes de digitar o cartão.
 */
async function reservaCobravel(token: string) {
  const linha = await reservaPorToken(token);
  if (!linha) throw new CheckoutError("Não encontrei esta reserva.");
  if (linha.paymentStatus === "pago") throw new CheckoutError("Este horário já está pago.");
  if (linha.paymentStatus !== "aguardando" || !linha.valorCents) {
    throw new CheckoutError("Esta reserva não está aguardando pagamento.");
  }
  if (linha.venceEm && linha.venceEm <= new Date()) {
    throw new CheckoutError("O prazo terminou e o horário voltou para a agenda.");
  }
  const conta = await credencialDaClinica(linha.organizationId);
  if (!conta) throw new CheckoutError("Esta clínica não está recebendo pagamento online agora.");
  return { linha, conta };
}

/**
 * A cliente do Asaas desta pessoa, criada uma vez e reaproveitada.
 *
 * Criar a cada cobrança encheria o painel da clínica de cliente repetida com o
 * mesmo CPF e deixaria o histórico dela inútil. O CPF fica gravado na ficha
 * porque pedir o mesmo documento a cada agendamento é atrito que ninguém
 * aceita duas vezes.
 */
async function clienteNoAsaas(
  linha: LinhaDaReserva,
  chave: string,
  cpf: string,
  email: string | null,
): Promise<string> {
  if (linha.asaasCustomerId) return linha.asaasCustomerId;

  const id = await criarCliente(chave, {
    nome: linha.nome,
    cpf,
    email: email || linha.email,
    telefone: linha.telefone,
  });

  await db
    .update(customers)
    .set({ asaasCustomerId: id, document: cpf.replace(/\D/g, "") })
    .where(eq(customers.id, linha.customerId));

  return id;
}

function descricaoDaCobranca(linha: LinhaDaReserva): string {
  const quando = formatTz(linha.startsAt, linha.fuso, "dd/MM 'às' HH:mm");
  const cheio = linha.valorCents === linha.precoCents;
  return cheio
    ? `${linha.servico} em ${linha.clinica}, ${quando}. Pagamento do atendimento.`
    : `${linha.servico} em ${linha.clinica}, ${quando}. Sinal para garantir o horário; o restante é pago no dia.`;
}

/**
 * O vencimento que vai para o Asaas.
 *
 * O Asaas trabalha com DATA e recusa vencimento no passado; o prazo de
 * verdade, de minutos, é o nosso. Manda o dia de hoje no fuso da clínica, que
 * é o dia em que a cliente está pagando.
 */
function vencimentoNoAsaas(linha: LinhaDaReserva): Date {
  return new Date(`${formatTz(new Date(), linha.fuso, "yyyy-MM-dd")}T12:00:00Z`);
}

export type PixParaPagar = { imagemBase64: string; copiaECola: string; valorCents: number };

/** Cria a cobrança PIX (ou reaproveita a que existe) e devolve o QR. */
export async function cobrarComPix(token: string, cpf: string): Promise<PixParaPagar> {
  const { linha, conta } = await reservaCobravel(token);
  if (!conta.pixReady) {
    throw new CheckoutError("Esta clínica ainda não recebe por PIX. Pague no cartão.");
  }

  /**
   * Cobrança PIX já criada não é criada de novo.
   *
   * A cliente que atualiza a página, ou volta do app do banco, tem de ver o
   * MESMO QR. Gerar outro deixaria dois códigos válidos para o mesmo horário,
   * e um deles viraria dinheiro a devolver.
   *
   * O tipo é conferido porque a cobrança que está lá pode ser de CARTÃO: quem
   * tentou cartão, caiu em análise e voltou para o PIX teria o QR pedido em
   * cima de uma cobrança de cartão, e o Asaas recusa isso com uma mensagem que
   * não explica nada. Nesse caso nasce uma cobrança PIX nova; a de cartão, se
   * ainda confirmar, é reconhecida pelo webhook pela referência externa.
   */
  if (linha.asaasPaymentId) {
    const atual = await buscarPagamento(conta.apiKey, linha.asaasPaymentId).catch(() => null);
    if (atual?.confirmada) throw new CheckoutError("Este horário já está pago.");
    if (atual && (atual.meio ?? "").toUpperCase() === "PIX") {
      const pix = await pixDaCobranca(conta.apiKey, linha.asaasPaymentId);
      return { ...pix, valorCents: linha.valorCents ?? 0 };
    }
  }

  const clienteId = await clienteNoAsaas(linha, conta.apiKey, cpf, null);
  const cobranca = await criarCobrancaPix(conta.apiKey, {
    clienteId,
    valorCents: linha.valorCents ?? 0,
    descricao: descricaoDaCobranca(linha),
    vencimento: vencimentoNoAsaas(linha),
    referencia: String(linha.id),
  });

  await db
    .update(appointments)
    .set({ asaasPaymentId: cobranca.id, updatedAt: new Date() })
    .where(eq(appointments.id, linha.id));

  const pix = await pixDaCobranca(conta.apiKey, cobranca.id);
  return { ...pix, valorCents: linha.valorCents ?? 0 };
}

export type DadosDoCartao = {
  cartao: CartaoDaCliente;
  cpf: string;
  email: string;
  cep: string;
  numeroDoEndereco: string;
};

/**
 * Cobra no cartão e responde na hora.
 *
 * Os dados do cartão passam por este servidor e não são guardados em lugar
 * nenhum: nem em coluna, nem em log, nem no objeto de erro. O Asaas devolve o
 * resultado na mesma chamada, então cartão recusado é uma frase para a cliente
 * ler, e não um estado pendurado na agenda.
 */
export async function cobrarComCartao(
  token: string,
  dados: DadosDoCartao,
  ip: string,
): Promise<{ pago: boolean }> {
  const { linha, conta } = await reservaCobravel(token);
  const clienteId = await clienteNoAsaas(linha, conta.apiKey, dados.cpf, dados.email);

  const cobranca = await criarCobrancaCartao(conta.apiKey, {
    clienteId,
    valorCents: linha.valorCents ?? 0,
    descricao: descricaoDaCobranca(linha),
    vencimento: vencimentoNoAsaas(linha),
    referencia: String(linha.id),
    cartao: dados.cartao,
    dono: {
      nome: dados.cartao.nomeImpresso || linha.nome,
      email: dados.email || linha.email || "",
      cpf: dados.cpf,
      cep: dados.cep,
      numeroDoEndereco: dados.numeroDoEndereco,
      telefone: linha.telefone ?? "",
    },
    ip,
  });

  await db
    .update(appointments)
    .set({ asaasPaymentId: cobranca.id, updatedAt: new Date() })
    .where(eq(appointments.id, linha.id));

  if (cobranca.confirmada) {
    await confirmarPagamento(linha.organizationId, {
      pagamentoId: cobranca.id,
      valorCents: linha.valorCents ?? 0,
      billingType: "CREDIT_CARD",
    });
    return { pago: true };
  }

  // Cartão em análise é raro, mas existe. A tela espera, como no PIX.
  return { pago: false };
}

/**
 * Pergunta ao Asaas se o dinheiro entrou, e confirma se sim.
 *
 * É o que sustenta a tela do PIX: esperar só pelo webhook deixaria a cliente
 * olhando um QR parado com o pagamento já feito. O webhook continua valendo
 * como rede de segurança para quem fechou a aba.
 */
export async function sincronizarPagamento(token: string): Promise<{ pago: boolean }> {
  const linha = await reservaPorToken(token);
  if (!linha) return { pago: false };
  if (linha.paymentStatus === "pago") return { pago: true };
  if (!linha.asaasPaymentId) return { pago: false };

  const conta = await credencialDaClinica(linha.organizationId);
  if (!conta) return { pago: false };

  const pagamento = await buscarPagamento(conta.apiKey, linha.asaasPaymentId);
  if (!pagamento.confirmada) return { pago: false };

  await confirmarPagamento(linha.organizationId, {
    pagamentoId: pagamento.id,
    valorCents: pagamento.valorCents || linha.valorCents || 0,
    billingType: pagamento.meio,
  });
  return { pago: true };
}

// ── O dinheiro ─────────────────────────────────────────────────────────────

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
export function meioDePagamento(
  billingType: string | null,
): "pix" | "cartao_credito" | "cartao_debito" | "outro" {
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

export type ChavesDoPagamento = {
  pagamentoId: string;
  /** `externalReference`: o id do agendamento, que mandamos ao Asaas. */
  referencia?: string | null;
  /** Só nas reservas nascidas antes de o checkout ser nosso. */
  linkId?: string | null;
};

/**
 * Acha a reserva de um aviso de pagamento.
 *
 * Três chaves, na ordem em que são confiáveis: o id da cobrança (o que
 * gravamos ao cobrar), a referência externa (o id do agendamento, que mandamos
 * ao Asaas) e o id do link hospedado, que só existe nas reservas do primeiro
 * dia do recurso. Sem a referência, um aviso que chegasse antes do nosso
 * UPDATE do id da cobrança não acharia reserva nenhuma.
 */
async function reservaDoPagamento(organizationId: number, chaves: ChavesDoPagamento) {
  const condicoes = [eq(appointments.asaasPaymentId, chaves.pagamentoId)];
  const referencia = Number(chaves.referencia);
  if (Number.isInteger(referencia) && referencia > 0) {
    condicoes.push(eq(appointments.id, referencia));
  }
  if (chaves.linkId) condicoes.push(eq(appointments.asaasPaymentLinkId, chaves.linkId));

  const [linha] = await db
    .select({
      id: appointments.id,
      customerId: appointments.customerId,
      paymentStatus: appointments.paymentStatus,
      status: appointments.status,
      valorCobrado: appointments.paymentAmountCents,
    })
    .from(appointments)
    .where(and(eq(appointments.organizationId, organizationId), or(...condicoes)))
    .limit(1);
  return linha ?? null;
}

/**
 * O pagamento caiu: confirma a reserva e registra o dinheiro.
 *
 * Idempotente de propósito. O Asaas manda `PAYMENT_CONFIRMED` e
 * `PAYMENT_RECEIVED` para a mesma cobrança, reentrega quando o nosso endpoint
 * falha, e a tela do PIX pergunta em paralelo: duas confirmações não podem
 * virar dois lançamentos no caixa.
 */
export async function confirmarPagamento(
  organizationId: number,
  entrada: ChavesDoPagamento & { valorCents: number; billingType: string | null },
): Promise<{ appointmentId: number } | null> {
  const reserva = await reservaDoPagamento(organizationId, entrada);
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
      console.warn(
        "[asaas] pagamento confirmado sem mudar o status:",
        erro instanceof Error ? erro.message : erro,
      );
    });
  }

  /**
   * A confirmação que a criação do agendamento deixou de mandar sai AGORA.
   *
   * É o momento em que ela é verdade. O livro-razão da automação dedupa por
   * regra e agendamento, então o `PAYMENT_RECEIVED` que chega depois do
   * `PAYMENT_CONFIRMED`, a reentrega do Asaas e a consulta da tela do PIX não
   * viram três mensagens para a mesma cliente.
   */
  await dispatchAppointmentCreatedAutomations(ctx, reserva.id).catch((erro) => {
    console.warn("[cobrança] confirmação não enviada:", erro instanceof Error ? erro.message : erro);
  });

  return { appointmentId: reserva.id };
}

/** Estorno: o horário volta a ficar sem pagamento, e a dona vê o motivo. */
export async function registrarEstorno(
  organizationId: number,
  chaves: ChavesDoPagamento,
): Promise<void> {
  const reserva = await reservaDoPagamento(organizationId, chaves);
  if (!reserva) return;
  await db
    .update(appointments)
    .set({ paymentStatus: "estornado", updatedAt: new Date() })
    .where(eq(appointments.id, reserva.id));
}

/**
 * Derruba as reservas que venceram sem pagamento.
 *
 * É esta varredura que devolve o horário para a grade. Sem ela, um carrinho
 * abandonado segura o melhor horário de sábado para sempre — e a cobrança
 * continuaria viva, aceitando um PIX de um horário que a clínica já teria dado
 * para outra pessoa.
 */
export async function expirarReservasVencidas(agora = new Date()): Promise<number> {
  const vencidas = await db
    .select({
      id: appointments.id,
      organizationId: appointments.organizationId,
      pagamentoId: appointments.asaasPaymentId,
    })
    .from(appointments)
    .where(and(eq(appointments.paymentStatus, "aguardando"), lt(appointments.paymentDueAt, agora)))
    .limit(200);

  let derrubadas = 0;
  for (const reserva of vencidas) {
    try {
      /**
       * Antes de derrubar, pergunta se pagou.
       *
       * Quem pagou no último minuto do prazo tem o dinheiro na conta da
       * clínica; cancelar por cima transformaria um pagamento legítimo em
       * horário perdido e valor a devolver. A corrida é estreita e acontece
       * justamente quando mais dói.
       */
      const conta = await credencialDaClinica(reserva.organizationId);
      if (conta && reserva.pagamentoId) {
        const pagamento = await buscarPagamento(conta.apiKey, reserva.pagamentoId).catch(() => null);
        if (pagamento?.confirmada) {
          await confirmarPagamento(reserva.organizationId, {
            pagamentoId: pagamento.id,
            valorCents: pagamento.valorCents,
            billingType: pagamento.meio,
          });
          continue;
        }
      }

      const ctx = await systemContext(reserva.organizationId);
      await changeStatus(ctx, reserva.id, "cancelled", {
        cancelReason: "Pagamento não confirmado no prazo da reserva.",
        actor: { type: "system" },
      });
      await db
        .update(appointments)
        .set({
          paymentStatus: "vencido",
          paymentUrl: null,
          // O token morre com a reserva: o checkout dela não abre mais.
          paymentToken: null,
          updatedAt: new Date(),
        })
        .where(eq(appointments.id, reserva.id));

      // Cobrança viva é cobrança que alguém ainda paga.
      if (conta && reserva.pagamentoId) {
        await apagarCobranca(conta.apiKey, reserva.pagamentoId).catch(() => undefined);
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
