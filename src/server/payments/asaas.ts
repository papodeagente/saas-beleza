import "server-only";

/**
 * Cliente do Asaas, uma conta por clínica.
 *
 * A plataforma NÃO intermedia pagamento: a credencial é da clínica, a cobrança
 * nasce na conta dela e o dinheiro cai lá. Nada aqui usa chave da plataforma, e
 * não existe chave global de Asaas neste sistema.
 *
 * Duas decisões que vêm de integração de Asaas já feita em outro produto e
 * economizam meia tarde de depuração:
 *
 * 1. **O ambiente sai do prefixo da chave, nunca de um seletor na tela.**
 *    Quem cola chave de sandbox achando que é produção descobre isso quando o
 *    dinheiro não chega; ler o prefixo elimina a classe inteira de erro.
 * 2. **`User-Agent` é obrigatório.** Sem ele o Asaas recusa a chamada, e a
 *    mensagem de erro não diz que o problema é o cabeçalho.
 *
 * O modelo de cobrança é LINK DE PAGAMENTO, não cobrança com cliente
 * cadastrado: criar cliente na API do Asaas exige CPF/CNPJ, e pedir CPF para
 * marcar unha é atrito que derruba agendamento. O link hospedado aceita PIX,
 * cartão e boleto sem exigir documento antes.
 */

export type AmbienteAsaas = "producao" | "sandbox";

export class AsaasError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "AsaasError";
  }
}

/** Chave inválida ou revogada: erro de credencial, não de rede. */
export class AsaasAuthError extends AsaasError {
  constructor(body: string) {
    super("O Asaas recusou esta chave.", 401, body);
    this.name = "AsaasAuthError";
  }
}

const TIMEOUT_MS = 20_000;

export function ambienteDaChave(chave: string): AmbienteAsaas {
  return chave.trim().startsWith("$aact_prod_") ? "producao" : "sandbox";
}

function baseDaChave(chave: string): string {
  return ambienteDaChave(chave) === "producao"
    ? "https://api.asaas.com/v3"
    : "https://api-sandbox.asaas.com/v3";
}

/** Só os últimos caracteres. A chave inteira nunca volta para o navegador. */
export function mascararChave(chave: string): string {
  const limpa = chave.trim();
  return limpa.length <= 10 ? "••••" : `••••${limpa.slice(-6)}`;
}

async function pedir<T>(
  chave: string,
  metodo: "GET" | "POST" | "PUT" | "DELETE",
  caminho: string,
  corpo?: unknown,
): Promise<T> {
  const resposta = await fetch(`${baseDaChave(chave)}${caminho}`, {
    method: metodo,
    headers: {
      access_token: chave.trim(),
      "Content-Type": "application/json",
      // Obrigatório: sem isto o Asaas recusa, e o erro não explica por quê.
      "User-Agent": "AgendaDeUnha",
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const texto = await resposta.text().catch(() => "");
  if (resposta.status === 401 || resposta.status === 403) throw new AsaasAuthError(texto.slice(0, 300));
  if (!resposta.ok) {
    throw new AsaasError(
      `Asaas ${metodo} ${caminho} devolveu ${resposta.status}.`,
      resposta.status,
      texto.slice(0, 500),
    );
  }
  return (texto ? JSON.parse(texto) : {}) as T;
}

// ── A conta ────────────────────────────────────────────────────────────────

export type ContaAsaas = { nome: string | null; email: string | null; ambiente: AmbienteAsaas };

/**
 * Confere a chave e devolve de quem ela é.
 *
 * Validar na hora de conectar, e não no primeiro pagamento, é o que evita o
 * pior modo de falha: tudo parecendo certo na tela e a descoberta acontecendo
 * quando uma cliente tenta pagar.
 */
export async function contaDoAsaas(chave: string): Promise<ContaAsaas> {
  const dados = await pedir<{ name?: string; email?: string; companyName?: string }>(
    chave,
    "GET",
    "/myAccount",
  );
  return {
    nome: dados.companyName || dados.name || null,
    email: dados.email || null,
    ambiente: ambienteDaChave(chave),
  };
}

// ── A cobrança ─────────────────────────────────────────────────────────────

export type LinkDePagamento = { id: string; url: string };

/**
 * Um link de cobrança para UMA reserva.
 *
 * `chargeType: DETACHED` é cobrança avulsa (não assinatura). `billingType:
 * UNDEFINED` deixa a cliente escolher PIX, cartão ou boleto na própria tela do
 * Asaas. `notificationEnabled: false` porque quem avisa a cliente somos nós,
 * pelo WhatsApp que ela já está usando: e-mail de cobrança em nome de uma
 * clínica de unha cai em spam e assusta.
 */
export async function criarLinkDePagamento(
  chave: string,
  entrada: { nome: string; descricao: string; valorCents: number; expiraEm: Date },
): Promise<LinkDePagamento> {
  if (entrada.valorCents < 500) {
    // O Asaas recusa cobrança abaixo de R$ 5,00, e a mensagem dele é genérica.
    throw new AsaasError("O Asaas não aceita cobrança abaixo de R$ 5,00.", 400, "");
  }

  const dados = await pedir<{ id?: string; url?: string }>(chave, "POST", "/paymentLinks", {
    name: entrada.nome.slice(0, 100),
    description: entrada.descricao.slice(0, 500),
    billingType: "UNDEFINED",
    chargeType: "DETACHED",
    value: Number((entrada.valorCents / 100).toFixed(2)),
    // O Asaas trabalha com DATA, não com instante: o link vale até o fim do
    // dia. O prazo curto de verdade é o nosso, gravado na reserva.
    endDate: entrada.expiraEm.toISOString().slice(0, 10),
    notificationEnabled: false,
  });

  if (!dados.id || !dados.url) {
    throw new AsaasError("O Asaas criou o link sem devolver id e url.", 500, JSON.stringify(dados).slice(0, 300));
  }
  return { id: dados.id, url: dados.url };
}

/** Desativa o link de uma reserva que caiu. Link vivo é cobrança viva. */
export async function desativarLink(chave: string, linkId: string): Promise<void> {
  await pedir(chave, "DELETE", `/paymentLinks/${linkId}`);
}

export type PagamentoAsaas = {
  id: string;
  status: string;
  linkId: string | null;
  valorCents: number;
  meio: string | null;
};

/** O pagamento como o Asaas o conhece. Usado para conferir o que o webhook diz. */
export async function buscarPagamento(chave: string, pagamentoId: string): Promise<PagamentoAsaas> {
  const dados = await pedir<{
    id: string;
    status: string;
    paymentLink?: string | null;
    value?: number;
    billingType?: string;
  }>(chave, "GET", `/payments/${pagamentoId}`);
  return {
    id: dados.id,
    status: dados.status,
    linkId: dados.paymentLink ?? null,
    valorCents: Math.round((dados.value ?? 0) * 100),
    meio: dados.billingType ?? null,
  };
}

// ── O webhook ──────────────────────────────────────────────────────────────

/**
 * Registra o nosso webhook na conta da clínica.
 *
 * Feito por API de propósito: a alternativa é a dona abrir o painel do Asaas,
 * achar a aba de integrações e colar uma URL com um segredo de 48 caracteres.
 * Toda clínica que errar isso vira um chamado de suporte em que o pagamento
 * cai e o agendamento não confirma.
 *
 * Conta antiga do Asaas pode não expor esta rota. Quando ela recusar, a
 * conexão continua valendo e a tela mostra a URL para colar à mão — é o que
 * mantém o recurso utilizável em vez de bloquear a clínica.
 */
export async function registrarWebhook(
  chave: string,
  entrada: { url: string; authToken: string; email: string | null },
): Promise<{ id: string | null; automatico: boolean }> {
  try {
    const dados = await pedir<{ id?: string }>(chave, "POST", "/webhooks", {
      name: "Agenda de Unha",
      url: entrada.url,
      email: entrada.email ?? undefined,
      enabled: true,
      interrupted: false,
      authToken: entrada.authToken,
      sendType: "SEQUENTIALLY",
      events: ["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED", "PAYMENT_REFUNDED", "PAYMENT_OVERDUE"],
    });
    return { id: dados.id ?? null, automatico: true };
  } catch (erro) {
    if (erro instanceof AsaasAuthError) throw erro;
    console.warn("[asaas] webhook não registrado automaticamente:", erro instanceof Error ? erro.message : erro);
    return { id: null, automatico: false };
  }
}

/** Remove o webhook que criamos, quando a clínica desconecta. */
export async function removerWebhook(chave: string, webhookId: string): Promise<void> {
  await pedir(chave, "DELETE", `/webhooks/${webhookId}`).catch(() => undefined);
}
