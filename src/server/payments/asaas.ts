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
 * O checkout é NOSSO: a cliente paga dentro do Agenda de Unha, escolhendo PIX
 * ou cartão, sem ser jogada num site que ela não reconhece no meio de um
 * agendamento. O preço disso é o CPF — o Asaas exige cliente cadastrada para
 * cobrar por API, e cliente sem CPF ele não cria. Era exatamente o atrito que
 * o link hospedado evitava, e foi trocado de propósito por uma tela que não
 * abandona a cliente.
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

/**
 * A frase que o Asaas manda quando recusa.
 *
 * Cartão recusado volta como 400 com `errors[0].description` ("Transação não
 * autorizada", "Cartão expirado"). Essa frase é a ÚNICA informação útil para
 * quem está tentando pagar; engolir ela e mostrar "erro 400" faria a cliente
 * tentar o mesmo cartão de novo sem saber o que houve.
 */
function motivoDoAsaas(texto: string): string | null {
  try {
    const corpo = JSON.parse(texto) as { errors?: { description?: string }[] };
    const descricao = corpo.errors?.[0]?.description?.trim();
    return descricao ? descricao : null;
  } catch {
    return null;
  }
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
      motivoDoAsaas(texto) ?? `Asaas ${metodo} ${caminho} devolveu ${resposta.status}.`,
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

// ── A cliente ─────────────────────────────────────────────────────────────

/**
 * A pessoa que paga, do lado do Asaas.
 *
 * O Asaas EXIGE CPF para criar cliente, e exige cliente para criar cobrança
 * por API. É por isso que o checkout pede CPF: não é zelo nosso, é condição
 * para a cobrança existir. Era justamente o que o link hospedado evitava — e
 * foi o preço combinado para o pagamento acontecer dentro do sistema, sem
 * jogar a cliente num site que ela não reconhece.
 */
export async function criarCliente(
  chave: string,
  entrada: { nome: string; cpf: string; email?: string | null; telefone?: string | null },
): Promise<string> {
  const dados = await pedir<{ id?: string }>(chave, "POST", "/customers", {
    name: entrada.nome.slice(0, 100),
    cpfCnpj: somenteDigitos(entrada.cpf),
    email: entrada.email || undefined,
    mobilePhone: entrada.telefone ? somenteDigitos(entrada.telefone) : undefined,
    notificationDisabled: true,
  });
  if (!dados.id) throw new AsaasError("O Asaas criou a cliente sem devolver id.", 500, "");
  return dados.id;
}

function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

// ── A cobrança ─────────────────────────────────────────────────────────────

export type CobrancaAsaas = { id: string; status: string; confirmada: boolean };

/** Status em que o dinheiro já é da clínica. O resto ainda não fechou. */
export function pagamentoConfirmado(status: string): boolean {
  return status === "CONFIRMED" || status === "RECEIVED" || status === "RECEIVED_IN_CASH";
}

type BaseDaCobranca = {
  clienteId: string;
  valorCents: number;
  descricao: string;
  vencimento: Date;
  referencia: string;
};

function corpoBase(entrada: BaseDaCobranca) {
  return {
    customer: entrada.clienteId,
    value: Number((entrada.valorCents / 100).toFixed(2)),
    // O Asaas trabalha com DATA no vencimento. O prazo curto de verdade é o
    // nosso, gravado na reserva; este aqui só não pode ser no passado.
    dueDate: entrada.vencimento.toISOString().slice(0, 10),
    description: entrada.descricao.slice(0, 500),
    externalReference: entrada.referencia,
  };
}

/** Cobrança PIX. O QR vem depois, em `pixDaCobranca`. */
export async function criarCobrancaPix(
  chave: string,
  entrada: BaseDaCobranca,
): Promise<CobrancaAsaas> {
  const dados = await pedir<{ id?: string; status?: string }>(chave, "POST", "/payments", {
    ...corpoBase(entrada),
    billingType: "PIX",
  });
  if (!dados.id) throw new AsaasError("O Asaas criou a cobrança sem devolver id.", 500, "");
  return { id: dados.id, status: dados.status ?? "PENDING", confirmada: pagamentoConfirmado(dados.status ?? "") };
}

export type CartaoDaCliente = {
  numero: string;
  nomeImpresso: string;
  mes: string;
  ano: string;
  cvv: string;
};

export type DonoDoCartao = {
  nome: string;
  email: string;
  cpf: string;
  cep: string;
  numeroDoEndereco: string;
  telefone: string;
};

/**
 * Cobrança no cartão, cobrada na hora.
 *
 * Os dados do cartão passam por este servidor e NÃO são guardados em lugar
 * nenhum: nem em coluna, nem em log, nem no objeto de erro. O Asaas devolve o
 * resultado na mesma chamada, então cartão recusado é resposta imediata para a
 * cliente, e não um estado pendurado.
 *
 * `remoteIp` é exigido pelo antifraude do Asaas. Sem ele a cobrança é recusada
 * com uma mensagem que não diz qual campo faltou.
 */
export async function criarCobrancaCartao(
  chave: string,
  entrada: BaseDaCobranca & { cartao: CartaoDaCliente; dono: DonoDoCartao; ip: string },
): Promise<CobrancaAsaas> {
  const dados = await pedir<{ id?: string; status?: string }>(chave, "POST", "/payments", {
    ...corpoBase(entrada),
    billingType: "CREDIT_CARD",
    creditCard: {
      holderName: entrada.cartao.nomeImpresso,
      number: somenteDigitos(entrada.cartao.numero),
      expiryMonth: entrada.cartao.mes,
      expiryYear: entrada.cartao.ano,
      ccv: entrada.cartao.cvv,
    },
    creditCardHolderInfo: {
      name: entrada.dono.nome,
      email: entrada.dono.email,
      cpfCnpj: somenteDigitos(entrada.dono.cpf),
      postalCode: somenteDigitos(entrada.dono.cep),
      addressNumber: entrada.dono.numeroDoEndereco,
      phone: somenteDigitos(entrada.dono.telefone),
    },
    remoteIp: entrada.ip,
  });
  if (!dados.id) throw new AsaasError("O Asaas criou a cobrança sem devolver id.", 500, "");
  return { id: dados.id, status: dados.status ?? "PENDING", confirmada: pagamentoConfirmado(dados.status ?? "") };
}

export type PixDaCobranca = { imagemBase64: string; copiaECola: string };

/** O QR e o copia e cola, para a cliente pagar sem sair da nossa tela. */
export async function pixDaCobranca(chave: string, cobrancaId: string): Promise<PixDaCobranca> {
  const dados = await pedir<{ encodedImage?: string; payload?: string }>(
    chave,
    "GET",
    `/payments/${cobrancaId}/pixQrCode`,
  );
  if (!dados.encodedImage || !dados.payload) {
    throw new AsaasError("O Asaas não devolveu o QR do PIX.", 500, "");
  }
  return { imagemBase64: dados.encodedImage, copiaECola: dados.payload };
}

/**
 * Apaga a cobrança de uma reserva que caiu.
 *
 * Cobrança viva é cobrança que alguém ainda pode pagar. Depois que o horário
 * voltou para a grade, um PIX pago vira dinheiro que a clínica precisa
 * devolver.
 */
export async function apagarCobranca(chave: string, cobrancaId: string): Promise<void> {
  await pedir(chave, "DELETE", `/payments/${cobrancaId}`);
}

export type PagamentoAsaas = {
  id: string;
  status: string;
  confirmada: boolean;
  valorCents: number;
  meio: string | null;
};

/**
 * O pagamento como o Asaas o conhece.
 *
 * É a fonte da verdade do PIX: a tela pergunta de novo a cada poucos segundos
 * enquanto a cliente paga, porque esperar só pelo webhook deixaria a tela
 * parada mesmo com o dinheiro já na conta.
 */
export async function buscarPagamento(chave: string, pagamentoId: string): Promise<PagamentoAsaas> {
  const dados = await pedir<{
    id: string;
    status?: string;
    value?: number;
    billingType?: string;
  }>(chave, "GET", `/payments/${pagamentoId}`);
  const status = dados.status ?? "";
  return {
    id: dados.id,
    status,
    confirmada: pagamentoConfirmado(status),
    valorCents: Math.round((dados.value ?? 0) * 100),
    meio: dados.billingType ?? null,
  };
}

/**
 * A conta tem chave PIX cadastrada?
 *
 * Sem chave PIX o Asaas aceita criar a cobrança e recusa o QR — o erro
 * apareceria só na cara da cliente, no meio do pagamento. Perguntar na hora de
 * conectar deixa o aviso onde a dona pode resolver.
 */
export async function temChavePix(chave: string): Promise<boolean> {
  try {
    const dados = await pedir<{ data?: unknown[] }>(chave, "GET", "/pix/addressKeys?status=ACTIVE");
    return Array.isArray(dados.data) && dados.data.length > 0;
  } catch (erro) {
    if (erro instanceof AsaasAuthError) throw erro;
    return false;
  }
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
