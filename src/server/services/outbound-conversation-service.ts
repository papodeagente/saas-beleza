import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, or } from "drizzle-orm";
import { db } from "@/db";
import { conversations, customers, messages } from "@/db/schema";
import type { TenantContext } from "@/server/auth";
import { resolveConversation } from "@/server/services/conversation-resolver";
import { credentialsOf, getConnectionRow } from "@/server/services/whatsapp-connection-service";
import { sendMessageToConversation } from "@/server/services/whatsapp-message-service";
import { canonicalBrPhone, digitsOnly, jidFromPhone } from "@/server/whatsapp/phone";
import {
  UazapiAuthError,
  UazapiError,
  UazapiRateLimitError,
  checkNumbers,
} from "@/server/whatsapp/uazapi-client";

/**
 * A clínica começa a conversa.
 *
 * Até aqui uma conversa só nascia de mensagem RECEBIDA. Este é o caminho
 * inverso, e ele tem duas regras que não são detalhe de implementação:
 *
 * 1. Nenhuma conversa existe sem mensagem. A lista do inbox ordena por
 *    `last_message_at desc` e o Postgres coloca NULL PRIMEIRO (verificado:
 *    `order by v desc` sobre {2026, null, 2020} devolve null, 2026, 2020) — uma
 *    conversa criada e não enviada gruda no topo de TODAS as abas, para todo o
 *    time, sem nada dentro. Por isso o envio é a última etapa e, se ele falhar
 *    SEM ter gravado mensagem, o que acabou de nascer é apagado antes de o erro
 *    voltar. Com mensagem gravada é o contrário: ela já saiu, a conversa fica.
 *
 * 2. Quem escolhe a forma do JID é o WhatsApp, não nós. O mesmo celular é
 *    `5584981282118` no cadastro e `558481282118@s.whatsapp.net` na conversa
 *    (caso real, conversa 43). Montar o JID a partir do telefone acerta em
 *    alguns números e erra em outros, sempre em silêncio: a mensagem "sai" e
 *    nunca chega. O endereço vem de `/chat/check`, que é quem sabe.
 */

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

export type StartErrorCode =
  | "SEM_CONEXAO"
  | "DESCONECTADO"
  | "MENSAGEM_VAZIA"
  | "CLIENTE_NAO_ENCONTRADA"
  | "CLIENTE_SEM_TELEFONE"
  | "TELEFONE_INVALIDO"
  | "NOME_OBRIGATORIO"
  | "LIMITE_ATINGIDO"
  | "VERIFICACAO_INDISPONIVEL"
  | "SEM_WHATSAPP"
  | "ENVIO_FALHOU"
  /**
   * O provedor ACEITOU a mensagem e algo quebrou depois dela.
   *
   * Separado de `ENVIO_FALHOU` porque é o único desfecho de erro em que a
   * cliente JÁ recebeu: quem for retentar automaticamente precisa saber a
   * diferença, senão a retentativa é uma segunda mensagem.
   */
  | "ENVIO_INCERTO";

export type StartConversationResult =
  | {
      ok: true;
      conversationId: number;
      customerId: number | null;
      /** Verdadeiro quando a mensagem entrou numa conversa que já existia. */
      reused: boolean;
    }
  | {
      ok: false;
      code: StartErrorCode;
      /** Texto para a tela, em português e sem jargão. */
      error: string;
      /**
       * Erro CRU do provedor. Quem chama grava isto no registro do disparo: o
       * texto de interface diz "tente de novo em instantes" para meia dúzia de
       * causas diferentes, e depurar com ele é impossível.
       */
      detail?: string;
    };

type Falha = Extract<StartConversationResult, { ok: false }>;

function falha(code: StartErrorCode, error: string, detail?: string): Falha {
  return { ok: false, code, error, detail };
}

/** Resumo técnico do erro, com o corpo da resposta quando o provedor mandou um. */
function detalheTecnico(erro: unknown): string {
  if (erro instanceof UazapiError) {
    return `${erro.name} ${erro.status}: ${(erro.body || erro.message).slice(0, 400)}`;
  }
  if (erro instanceof Error) return `${erro.name}: ${erro.message}`.slice(0, 400);
  return String(erro).slice(0, 400);
}

export type StartConversationInput = {
  /** Cliente já cadastrada. Tem precedência sobre `phone`. */
  customerId?: number | null;
  /** Número digitado, em qualquer formatação. Ignorado quando há `customerId`. */
  phone?: string | null;
  /** Nome para o cadastro novo. Obrigatório no caminho do número digitado. */
  name?: string | null;
  body: string;
  /** Envio operacional sem usuário humano (automações e confirmações). */
  automated?: boolean;
};

/**
 * Teto de conversas NOVAS por hora, por conta.
 *
 * Não é limite de produto, é proteção do número da clínica: o WhatsApp bloqueia
 * quem dispara para muitos desconhecidos em pouco tempo, e um bloqueio derruba
 * o atendimento inteiro, não só o disparo. Conversa que já existe não conta —
 * responder alguém que falou com a clínica não é o comportamento arriscado.
 */
export const MAX_CONVERSAS_NOVAS_POR_HORA = 30;

// ---------------------------------------------------------------------------
// Telefone: as formas em que o mesmo número aparece guardado
// ---------------------------------------------------------------------------

/**
 * Todas as formas em que o MESMO celular brasileiro pode estar gravado.
 *
 * Convivem duas normalizações na base, e isso é fato observado, não hipótese:
 * dos 25 clientes da organização 1, 19 têm telefone com 11 dígitos (gravado
 * pelo cadastro, que só tira a pontuação do que a recepção digitou) e 6 com o
 * DDI (gravados pelo WhatsApp, na forma canônica). Somar a isso o nono dígito,
 * que o WhatsApp inclui ou não conforme lhe convém, dá quatro escritas
 * possíveis para um número só. Procurar por uma delas encontra menos da metade
 * da base — e o que não é encontrado vira cadastro duplicado.
 */
export function brPhoneVariants(raw: string | null | undefined): string[] {
  const canonical = canonicalBrPhone(raw);
  if (!canonical) return [];

  const formas = new Set<string>([canonical]);
  if (canonical.startsWith("55")) {
    const local = canonical.slice(2);
    formas.add(local);
    // Celular com nono dígito: a forma antiga é o mesmo aparelho.
    if (local.length === 11 && local[2] === "9") {
      const semNono = local.slice(0, 2) + local.slice(3);
      formas.add(semNono);
      formas.add(`55${semNono}`);
    }
  }
  return [...formas];
}

/**
 * Recusa o que claramente não vai chegar a lugar nenhum, sem tentar validar
 * operadora ou existência — quem sabe se o número existe é o WhatsApp, e é a
 * ele que perguntamos depois.
 */
function telefonePlausivel(canonical: string): boolean {
  if (canonical.startsWith("55")) {
    const local = canonical.length - 2;
    return local === 10 || local === 11;
  }
  // Estrangeiro com DDI: E.164 vai até 15 dígitos.
  return canonical.length >= 10 && canonical.length <= 15;
}

// ---------------------------------------------------------------------------
// Leituras
// ---------------------------------------------------------------------------

async function findCustomerByPhone(organizationId: number, variants: string[]) {
  if (variants.length === 0) return null;
  const [row] = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(and(eq(customers.organizationId, organizationId), inArray(customers.phone, variants)))
    .orderBy(asc(customers.id))
    .limit(1);
  return row ?? null;
}

/**
 * Conversa que já existe para este número, em qualquer das escritas dele.
 *
 * Só conversas COM endereço no WhatsApp entram: a que ainda não tem JID não
 * sabe para onde enviar, e o caminho normal (verificar o número e deixar o
 * resolver adotá-la) é justamente o que preenche esse endereço.
 */
async function findConversationByPhone(organizationId: number, variants: string[]) {
  if (variants.length === 0) return null;
  const [row] = await db
    .select({ id: conversations.id, customerId: conversations.customerId })
    .from(conversations)
    .where(
      and(
        eq(conversations.organizationId, organizationId),
        eq(conversations.isGroup, false),
        isNotNull(conversations.remoteJid),
        or(
          inArray(conversations.phone, variants),
          inArray(conversations.remoteJid, variants.map(jidFromPhone)),
        ),
      ),
    )
    .orderBy(asc(conversations.id))
    .limit(1);
  return row ?? null;
}

/**
 * Quantas conversas a conta abriu na última hora, com o teto como limite da
 * consulta: passar de 30 não muda a decisão, então não há por que contar mais.
 *
 * A contagem é por `startedBy` (origem) e NÃO por `startedByUserId` (autor).
 * Enquanto olhava para o autor, o envio automático — que não tem usuário — não
 * aparecia aqui: uma automação de aniversário abria conversa atrás de conversa
 * em rajada, com o teto marcando zero o tempo todo. É esse furo que faz o
 * WhatsApp bloquear o número da clínica, e um número bloqueado derruba o
 * atendimento inteiro, não só a campanha.
 */
async function contarConversasIniciadas(organizationId: number): Promise<number> {
  const desde = new Date(Date.now() - 3_600_000);
  const rows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.organizationId, organizationId),
        isNotNull(conversations.startedBy),
        gte(conversations.createdAt, desde),
      ),
    )
    .limit(MAX_CONVERSAS_NOVAS_POR_HORA);
  return rows.length;
}

// ---------------------------------------------------------------------------
// Destinatário
// ---------------------------------------------------------------------------

type Destinatario = {
  ok: true;
  /** Cadastro que já existe. Nulo quando ainda será preciso criar um. */
  customerId: number | null;
  /** Nome do cadastro a criar. Preenchido só quando `customerId` é nulo. */
  nomeNovo: string | null;
  phone: string;
  contactName: string;
};

/**
 * Quem vai receber, e em que número.
 *
 * Nas duas portas o cadastro é decidido AQUI, e não deixado para o resolver:
 * ele procura cliente comparando com o telefone canônico, e é essa comparação
 * que não encontra os 19 cadastros gravados sem o 55 — o resolver criaria um
 * segundo cadastro para a mesma pessoa.
 *
 * O que esta função NÃO faz é escrever. O cadastro novo só nasce depois de o
 * WhatsApp confirmar o número: número errado não pode deixar uma ficha de
 * cliente para trás.
 */
async function resolverDestinatario(
  ctx: TenantContext,
  input: StartConversationInput,
): Promise<Destinatario | Falha> {
  if (input.customerId) {
    const [cliente] = await db
      .select({ id: customers.id, name: customers.name, phone: customers.phone })
      .from(customers)
      .where(and(eq(customers.id, input.customerId), eq(customers.organizationId, ctx.organizationId)))
      .limit(1);
    if (!cliente) {
      return falha(
        "CLIENTE_NAO_ENCONTRADA",
        "Essa cliente não está mais no cadastro. Faça a busca de novo e escolha outra vez.",
      );
    }
    const phone = canonicalBrPhone(cliente.phone);
    if (!phone || !telefonePlausivel(phone)) {
      return falha(
        "CLIENTE_SEM_TELEFONE",
        `${cliente.name} não tem um telefone válido no cadastro. Abra a ficha dela, corrija o número e tente de novo.`,
      );
    }
    return { ok: true, customerId: cliente.id, nomeNovo: null, phone, contactName: cliente.name };
  }

  const phone = canonicalBrPhone(input.phone ?? "");
  if (!phone || !telefonePlausivel(phone)) {
    return falha("TELEFONE_INVALIDO", "Número incompleto. Digite com DDD, por exemplo (11) 98765-4321.");
  }

  const nome = (input.name ?? "").trim();
  if (!nome) {
    return falha(
      "NOME_OBRIGATORIO",
      "Escreva o nome da cliente. Sem ele o cadastro nasce chamado “(11) 98765-4321”.",
    );
  }

  const existente = await findCustomerByPhone(ctx.organizationId, brPhoneVariants(phone));
  if (existente) {
    // Nome que já está na ficha manda: quem digitou o número agora pode ter
    // escrito só o primeiro nome, e sobrescrever apagaria o que a recepção
    // levou meses para arrumar.
    return { ok: true, customerId: existente.id, nomeNovo: null, phone, contactName: existente.name };
  }

  return { ok: true, customerId: null, nomeNovo: nome, phone, contactName: nome };
}

/**
 * Cria o cadastro do número que ainda não tinha um.
 *
 * `source: "manual"` porque foi uma pessoa que digitou: é o que impede que o
 * nome do perfil do WhatsApp passe por cima do nome escolhido pela clínica mais
 * tarde (a substituição só vale para cadastro de origem "whatsapp").
 */
async function criarCliente(
  ctx: TenantContext,
  phone: string,
  nome: string,
): Promise<{ id: number; criado: boolean } | null> {
  try {
    const [criado] = await db
      .insert(customers)
      .values({ organizationId: ctx.organizationId, name: nome, phone, source: "manual" })
      .returning({ id: customers.id });
    return { id: criado.id, criado: true };
  } catch (error) {
    // Corrida com outro cadastro do mesmo número (o índice único é por conta e
    // telefone). Quem perdeu apenas relê o vencedor.
    console.error("[conversa ativa] cadastro concorrente", error);
    const vencedor = await findCustomerByPhone(ctx.organizationId, brPhoneVariants(phone));
    return vencedor ? { id: vencedor.id, criado: false } : null;
  }
}

// ---------------------------------------------------------------------------
// Envio e limpeza
// ---------------------------------------------------------------------------

function mensagemDeFalhaNoEnvio(error: unknown): string {
  if (error instanceof UazapiAuthError) {
    return "O WhatsApp recusou o token desta conexão. Refaça a conexão em Configurações.";
  }
  if (error instanceof UazapiRateLimitError) {
    return "O WhatsApp está segurando os envios agora. Espere alguns minutos e tente de novo.";
  }
  // Sem afirmar o que aconteceu com a conversa: este mesmo texto atende o
  // reenvio numa conversa que já existia, e dizer "não foi aberta" ali é falso.
  return "Não foi possível enviar a mensagem agora. Tente de novo em instantes.";
}

/**
 * Único caso em que "deu erro" NÃO significa "não chegou".
 *
 * O aviso precisa dizer isso com todas as letras: quem lê "tente de novo"
 * escreve tudo outra vez, e a cliente recebe a mesma mensagem duas vezes.
 */
const AVISO_MENSAGEM_JA_SAIU =
  "A mensagem foi aceita pelo WhatsApp, mas algo falhou logo depois. Abra a conversa e confira antes de escrever de novo.";

/**
 * Marca da última mensagem da conversa.
 *
 * Comparada antes e depois do envio, ela responde a única pergunta que importa
 * quando dá erro: a mensagem chegou a ser gravada? Contar "tem alguma mensagem"
 * não serve — a conversa pode ser uma que já existia, cheia de histórico.
 */
async function ultimaMensagemId(conversationId: number): Promise<number | null> {
  const [row] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.id))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Apaga a conversa recém-criada. Devolve se ela realmente saiu — o cadastro só
 * pode ser removido depois dela, senão a chave estrangeira recusa.
 */
async function apagarConversa(organizationId: number, conversationId: number): Promise<boolean> {
  const apagadas = await db
    .delete(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .returning({ id: conversations.id });
  return apagadas.length > 0;
}

// ---------------------------------------------------------------------------
// Fluxo
// ---------------------------------------------------------------------------

export async function startOutboundConversation(
  ctx: TenantContext,
  input: StartConversationInput,
): Promise<StartConversationResult> {
  const body = input.body.trim();
  if (!body) return falha("MENSAGEM_VAZIA", "Escreva a mensagem antes de enviar.");

  // (1) Conexão. Antes de tudo, porque sem ela nada do resto tem sentido.
  const connection = await getConnectionRow(ctx.organizationId);
  if (!connection) {
    return falha(
      "SEM_CONEXAO",
      "Conecte o WhatsApp em Configurações antes de começar uma conversa.",
    );
  }
  if (connection.status !== "connected") {
    return falha(
      "DESCONECTADO",
      "O WhatsApp está desconectado. Reconecte em Configurações e tente de novo.",
    );
  }

  // (2) Destinatário e telefone canônico.
  const destinatario = await resolverDestinatario(ctx, input);
  if (!destinatario.ok) return destinatario;
  const variants = brPhoneVariants(destinatario.phone);
  const sendOptions = input.automated
    ? ({ sender: "system", senderUserId: null } as const)
    : ({ sender: "user", senderUserId: ctx.userId || null } as const);

  /**
   * (3) Conversa que já existe, ANTES de qualquer chamada externa.
   *
   * Duas razões para a ordem: não gastar uma chamada a um serviço de terceiro
   * para descobrir algo que o nosso banco já sabe, e não abrir uma segunda
   * conversa com a mesma pessoa — o que partiria o histórico em duas metades,
   * uma com o que enviamos e outra com o que ela respondeu.
   */
  const existente = await findConversationByPhone(ctx.organizationId, variants);
  if (existente) {
    const marcaExistente = await ultimaMensagemId(existente.id);
    try {
      await sendMessageToConversation(ctx.organizationId, existente.id, body, {
        ...sendOptions,
      });
    } catch (error) {
      console.error("[conversa ativa] falha ao enviar em conversa existente", error);
      // Mesma regra do caminho de conversa nova: se a mensagem chegou a ser
      // gravada, ela saiu, e mandar "tente de novo" faria a cliente receber
      // duas vezes.
      if ((await ultimaMensagemId(existente.id)) !== marcaExistente) {
        if (!input.automated) await assumirConversa(ctx, existente.id);
        return falha("ENVIO_INCERTO", AVISO_MENSAGEM_JA_SAIU, detalheTecnico(error));
      }
      return falha("ENVIO_FALHOU", mensagemDeFalhaNoEnvio(error), detalheTecnico(error));
    }
    if (!input.automated) await assumirConversa(ctx, existente.id);
    return {
      ok: true,
      conversationId: existente.id,
      customerId: existente.customerId ?? destinatario.customerId,
      reused: true,
    };
  }

  // (4) Limite de vazão.
  const iniciadas = await contarConversasIniciadas(ctx.organizationId);
  if (iniciadas >= MAX_CONVERSAS_NOVAS_POR_HORA) {
    return falha(
      "LIMITE_ATINGIDO",
      `Já foram abertas ${MAX_CONVERSAS_NOVAS_POR_HORA} conversas novas na última hora. Espere um pouco: o WhatsApp bloqueia números que falam com muitos desconhecidos de uma vez.`,
    );
  }

  /**
   * (5) O WhatsApp diz se o número existe e qual é o endereço dele.
   *
   * Falha de rede, token recusado ou excesso de chamadas NÃO viram "manda assim
   * mesmo": sem resposta não há JID, e sem JID o envio iria para um endereço
   * inventado. Melhor pedir para tentar de novo do que abrir uma conversa que
   * nunca vai chegar.
   */
  let verificacao: Awaited<ReturnType<typeof checkNumbers>>;
  try {
    verificacao = await checkNumbers(credentialsOf(connection), [destinatario.phone]);
  } catch (error) {
    console.error("[conversa ativa] /chat/check indisponível", error);
    return falha(
      "VERIFICACAO_INDISPONIVEL",
      "Não deu para confirmar esse número no WhatsApp agora. Tente de novo em instantes.",
      detalheTecnico(error),
    );
  }

  const linha =
    verificacao.find((r) => digitsOnly(r.query) === destinatario.phone) ??
    (verificacao.length === 1 ? verificacao[0] : undefined);
  if (!linha) {
    return falha(
      "VERIFICACAO_INDISPONIVEL",
      "Não deu para confirmar esse número no WhatsApp agora. Tente de novo em instantes.",
    );
  }
  if (!linha.exists) {
    return falha(
      "SEM_WHATSAPP",
      "Esse número não tem WhatsApp. Confira com a cliente antes de tentar de novo.",
    );
  }
  if (!linha.jid) {
    // Existe, mas veio sem endereço: adivinhar o JID é o erro que este passo
    // inteiro existe para evitar.
    return falha(
      "VERIFICACAO_INDISPONIVEL",
      "O WhatsApp confirmou o número mas não disse para onde enviar. Tente de novo em instantes.",
    );
  }

  // Confirmado o número, o cadastro pode nascer. Nesta ordem porque um número
  // errado não tem o direito de deixar uma ficha de cliente na base.
  let customerId = destinatario.customerId;
  let cadastroCriadoAgora = false;
  if (!customerId && destinatario.nomeNovo) {
    const cadastro = await criarCliente(ctx, destinatario.phone, destinatario.nomeNovo);
    if (!cadastro) {
      return falha("TELEFONE_INVALIDO", "Não foi possível cadastrar esse número. Confira e tente de novo.");
    }
    customerId = cadastro.id;
    cadastroCriadoAgora = cadastro.criado;
  }

  // (6) Conversa, com o JID que o WhatsApp devolveu — nunca um montado por nós.
  const resolvida = await resolveConversation({
    organizationId: ctx.organizationId,
    connectionId: connection.id,
    remoteJid: linha.jid,
    // O telefone gravado é o canônico que JÁ temos, e não um derivado do JID:
    // tirar o nono dígito é uma operação que perde informação (55 11 5555-4444
    // vira indistinguível de um fixo), e o telefone é a chave que evita conversa
    // duplicada. O JID guarda o endereço; esta coluna guarda a identidade.
    phone: destinatario.phone,
    contactName: destinatario.contactName,
    isGroup: false,
    customerId,
  });

  // A marca de origem é gravada antes do envio: é neste instante que a conta
  // gastou uma conversa nova, e o limite de vazão precisa enxergá-la mesmo se o
  // processo morrer no meio do envio.
  //
  // O envio automático grava origem SEM autor: não há usuário por trás dele, e
  // inventar um (usuário de sistema) sujaria a lista da equipe e o seletor de
  // responsável. O que importa para o teto é que a linha exista com origem
  // preenchida — antes, o `if` inteiro era pulado no caminho automático e a
  // conversa nascia invisível para o limite.
  if (resolvida.created) {
    await db
      .update(conversations)
      .set(
        input.automated
          ? { startedBy: "automation", startedByUserId: null }
          : { startedBy: "user", startedByUserId: ctx.userId },
      )
      .where(eq(conversations.id, resolvida.conversationId));
  }

  // (7) Envio. É ele que dá direito à conversa existir.
  const marca = await ultimaMensagemId(resolvida.conversationId);
  try {
    await sendMessageToConversation(ctx.organizationId, resolvida.conversationId, body, {
      ...sendOptions,
    });
  } catch (error) {
    console.error("[conversa ativa] falha ao enviar a primeira mensagem", error);

    /**
     * Mensagem gravada quer dizer mensagem ENTREGUE ao WhatsApp: ela só é
     * escrita depois que o provedor aceita. O que quebrou foi um passo posterior
     * dentro do mesmo envio, e a partir daqui nada pode ser apagado — a cliente
     * já recebeu. A conversa fica, com dono, porque uma conversa em que uma
     * pessoa acabou de falar não pertence à fila; e o aviso diz que a mensagem
     * saiu, senão a atendente reescreve e a cliente recebe duas vezes.
     */
    if ((await ultimaMensagemId(resolvida.conversationId)) !== marca) {
      if (!input.automated) await assumirConversa(ctx, resolvida.conversationId);
      return falha("ENVIO_INCERTO", AVISO_MENSAGEM_JA_SAIU, detalheTecnico(error));
    }

    if (resolvida.created) {
      const apagou = await apagarConversa(ctx.organizationId, resolvida.conversationId);
      // O cadastro criado nesta mesma chamada some junto — mas só se a conversa
      // saiu: enquanto ela existir, a ficha está referenciada por ela e apagá-la
      // é impossível. Falhar na limpeza não pode substituir o erro real que a
      // atendente precisa ler, então o problema fica no log.
      if (apagou && cadastroCriadoAgora && customerId) {
        await db
          .delete(customers)
          .where(and(eq(customers.id, customerId), eq(customers.organizationId, ctx.organizationId)))
          .catch((erroLimpeza) => console.error("[conversa ativa] cadastro órfão", erroLimpeza));
      }
    }
    return falha("ENVIO_FALHOU", mensagemDeFalhaNoEnvio(error), detalheTecnico(error));
  }

  // (8) A conversa nasce COM DONO: quem escreveu.
  if (!input.automated) await assumirConversa(ctx, resolvida.conversationId);

  return {
    ok: true,
    conversationId: resolvida.conversationId,
    customerId: resolvida.customerId ?? customerId,
    reused: !resolvida.created,
  };
}

/**
 * Atribui a conversa a quem falou.
 *
 * A regra "mensagem nova vai para a fila" é da mensagem RECEBIDA, e existe
 * porque ninguém em particular está esperando por ela. Aqui é o contrário: uma
 * pessoa específica começou o assunto e vai receber a resposta — mandá-la para
 * a fila faria a resposta cair no colo de quem não sabe do que se trata.
 *
 * O agente de IA não precisa ser pausado à mão: ele só ganha turno a partir de
 * mensagem recebida (único ponto de `enqueueAgentTurn`, no webhook, atrás de
 * `isNew && isInbound`) e, quando a resposta chegar, `pauseOnHumanReply` — ligado
 * por padrão — vê que a última saída foi de uma pessoa e recua.
 */
async function assumirConversa(ctx: TenantContext, conversationId: number): Promise<void> {
  await db
    .update(conversations)
    .set({
      controlledBy: "human",
      assignedUserId: ctx.userId,
      assignedAt: new Date(),
      status: "open",
      resolvedAt: null,
      resolvedByUserId: null,
    })
    .where(
      and(eq(conversations.id, conversationId), eq(conversations.organizationId, ctx.organizationId)),
    );
}

// ---------------------------------------------------------------------------
// Busca de cliente para a tela
// ---------------------------------------------------------------------------

export type OutboundCustomerOption = { id: number; name: string; phone: string | null };

/**
 * Busca de cliente NO SERVIDOR, por nome e por telefone.
 *
 * O telefone é procurado pelo trecho local: quem digita "98888-1234" não sabe
 * (nem deveria saber) se aquele cadastro foi gravado com ou sem o 55. Procurar
 * pelo sufixo encontra as duas escritas; procurar pelo canônico encontraria só
 * um quarto da base.
 */
export async function searchCustomersForOutbound(
  ctx: TenantContext,
  query: string,
  limit = 8,
): Promise<OutboundCustomerOption[]> {
  const termo = query.trim();
  if (!termo) return [];

  // `ilike` para não exigir que a atendente acerte maiúsculas — é o mesmo
  // comportamento da busca da lista de clientes.
  const condicoes = [ilike(customers.name, `%${termo}%`)];

  const digitos = digitsOnly(termo);
  if (digitos.length >= 3) {
    for (const forma of sufixosDeBusca(digitos)) {
      condicoes.push(ilike(customers.phone, `%${forma}%`));
    }
  }

  return db
    .select({ id: customers.id, name: customers.name, phone: customers.phone })
    .from(customers)
    .where(and(eq(customers.organizationId, ctx.organizationId), or(...condicoes)))
    .orderBy(asc(customers.name))
    .limit(limit);
}

/** Formas do que foi digitado que casam com as duas normalizações da base. */
function sufixosDeBusca(digitos: string): string[] {
  const formas = new Set<string>([digitos]);
  const semDdi = digitos.startsWith("55") && digitos.length > 11 ? digitos.slice(2) : digitos;
  formas.add(semDdi);
  if (semDdi.length === 11 && semDdi[2] === "9") {
    formas.add(semDdi.slice(0, 2) + semDdi.slice(3));
  }
  return [...formas];
}
