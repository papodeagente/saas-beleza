import "server-only";
import { addDays } from "date-fns";
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appointments,
  automationDispatches,
  automationRules,
  customers,
  organizationMembers,
  organizations,
  payments,
  professionals,
  services,
  users,
} from "@/db/schema";
import { dateISOInTz, formatTz, localDateTimeToUtc } from "@/lib/tz";
import type { TenantContext } from "@/server/auth";
import {
  type StartErrorCode,
  startOutboundConversation,
} from "@/server/services/outbound-conversation-service";

export type AutomationTrigger =
  | "appointment_created"
  | "before_appointment"
  | "appointment_day"
  | "after_appointment"
  | "after_purchase"
  | "birthday_before"
  | "birthday_day";

type Candidate = {
  sourceType: string;
  sourceId: number;
  customerId: number;
  customerName: string;
  consentMarketing: boolean;
  eventAt: Date;
  serviceName?: string | null;
  professionalName?: string | null;
};

export type AutomationRuleInput = {
  name: string;
  trigger: AutomationTrigger;
  daysOffset: number;
  sendTime: string;
  messageTemplate: string;
  active: boolean;
};

/** Momento de cada gatilho, escrito para completar a frase "ativa para enviar …". */
export const AUTOMATION_TRIGGER_LABEL: Record<AutomationTrigger, string> = {
  appointment_created: "assim que o agendamento é criado",
  before_appointment: "alguns dias antes do agendamento",
  appointment_day: "no dia do agendamento",
  after_appointment: "alguns dias depois do atendimento",
  after_purchase: "alguns dias depois da última compra",
  birthday_before: "alguns dias antes do aniversário",
  birthday_day: "no dia do aniversário",
};

/**
 * Recusa que a tela precisa mostrar com o texto que veio daqui.
 *
 * Sem um tipo próprio, a action engoliria a explicação num "não foi possível
 * criar a automação" — e a dona do salão criaria a segunda regra de novo, sem
 * nunca entender por que a cliente recebe tudo em dobro.
 */
export class AutomationRuleConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutomationRuleConflictError";
  }
}

const CONFLITO_DE_GATILHO = "automation_rules_active_trigger_unique";

/**
 * Reconhece a recusa do índice único parcial.
 *
 * Percorre a cadeia de `cause` porque a mensagem do erro que chega aqui é a do
 * driver ("Failed query: insert into ..."), e não a do Postgres — o nome da
 * restrição e o código 23505 ficam no erro original, embrulhado. Procurar pelo
 * texto no erro de cima devolvia falso sempre, e a corrida entre dois cliques
 * simultâneos estouraria como erro genérico em vez da explicação em português.
 */
function ehConflitoDeGatilho(erro: unknown): boolean {
  for (let atual: unknown = erro, salto = 0; atual && salto < 5; salto += 1) {
    const pg = atual as { code?: string; constraint?: string; message?: string; cause?: unknown };
    if (pg.code === "23505" && pg.constraint === CONFLITO_DE_GATILHO) return true;
    if (typeof pg.message === "string" && pg.message.includes(CONFLITO_DE_GATILHO)) return true;
    atual = pg.cause;
  }
  return false;
}

function mensagemDeConflito(trigger: AutomationTrigger, nomeExistente?: string): string {
  const qual = nomeExistente ? `“${nomeExistente}”` : "uma automação";
  return `Você já tem ${qual} ativa para enviar ${AUTOMATION_TRIGGER_LABEL[trigger]}. Pause ou remova a existente antes de ativar outra: com duas automações no mesmo momento, a cliente recebe a mesma mensagem duas vezes.`;
}

export async function listAutomationRules(ctx: TenantContext) {
  return db
    .select()
    .from(automationRules)
    .where(eq(automationRules.organizationId, ctx.organizationId))
    .orderBy(asc(automationRules.createdAt));
}

/** Regra ATIVA que já ocupa este gatilho na conta, ignorando `exceptId`. */
async function regraAtivaDoGatilho(
  organizationId: number,
  trigger: AutomationTrigger,
  exceptId?: number,
) {
  const [row] = await db
    .select({ id: automationRules.id, name: automationRules.name })
    .from(automationRules)
    .where(
      and(
        eq(automationRules.organizationId, organizationId),
        eq(automationRules.trigger, trigger),
        eq(automationRules.active, true),
        ...(exceptId ? [ne(automationRules.id, exceptId)] : []),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Cria a regra, recusando a segunda ativa no mesmo gatilho.
 *
 * Esta é a causa direta do envio triplicado: as regras 1, 2 e 3 da conta 550
 * tinham todas o gatilho `before_appointment` e cada uma abriu o seu disparo
 * para o agendamento 1326 (disparos 1, 4 e 7). O índice único do livro-razão
 * deduplica por REGRA — três regras são três chaves diferentes, e ele deixa
 * passar. Quem tem de segurar é isto aqui, mais o índice parcial no banco, que
 * fecha a corrida entre dois cliques simultâneos.
 */
export async function createAutomationRule(ctx: TenantContext, input: AutomationRuleInput) {
  if (input.active) {
    const existente = await regraAtivaDoGatilho(ctx.organizationId, input.trigger);
    if (existente) throw new AutomationRuleConflictError(mensagemDeConflito(input.trigger, existente.name));
  }
  try {
    await db.insert(automationRules).values({
      organizationId: ctx.organizationId,
      ...input,
      daysOffset:
        input.trigger === "appointment_day" || input.trigger === "appointment_created" || input.trigger === "birthday_day"
          ? 0
          : input.daysOffset,
      createdByUserId: ctx.userId,
    });
  } catch (error) {
    if (ehConflitoDeGatilho(error)) throw new AutomationRuleConflictError(mensagemDeConflito(input.trigger));
    throw error;
  }
}

export async function setAutomationRuleActive(ctx: TenantContext, id: number, active: boolean) {
  if (active) {
    const [regra] = await db
      .select({ trigger: automationRules.trigger })
      .from(automationRules)
      .where(and(eq(automationRules.id, id), eq(automationRules.organizationId, ctx.organizationId)))
      .limit(1);
    if (!regra) throw new Error("Automação não encontrada.");
    const existente = await regraAtivaDoGatilho(ctx.organizationId, regra.trigger, id);
    if (existente) throw new AutomationRuleConflictError(mensagemDeConflito(regra.trigger, existente.name));
  }
  try {
    const changed = await db
      .update(automationRules)
      .set({ active, updatedAt: new Date() })
      .where(and(eq(automationRules.id, id), eq(automationRules.organizationId, ctx.organizationId)))
      .returning({ id: automationRules.id, trigger: automationRules.trigger });
    if (!changed.length) throw new Error("Automação não encontrada.");
  } catch (error) {
    if (ehConflitoDeGatilho(error)) throw new AutomationRuleConflictError("Já existe uma automação ativa para este gatilho.");
    throw error;
  }
}

export async function deleteAutomationRule(ctx: TenantContext, id: number) {
  // Mantém o histórico de disparos: uma regra usada é apenas desativada.
  const used = await db
    .select({ id: automationDispatches.id })
    .from(automationDispatches)
    .where(and(eq(automationDispatches.organizationId, ctx.organizationId), eq(automationDispatches.ruleId, id)))
    .limit(1);
  if (used.length) return setAutomationRuleActive(ctx, id, false);
  await db
    .delete(automationRules)
    .where(and(eq(automationRules.id, id), eq(automationRules.organizationId, ctx.organizationId)));
}

export function automationScheduledFor(eventAt: Date, trigger: AutomationTrigger, days: number, time: string, timezone: string) {
  if (trigger === "appointment_created") return eventAt;
  const signedDays =
    trigger === "before_appointment" || trigger === "birthday_before"
      ? -days
      : trigger === "appointment_day" || trigger === "birthday_day"
        ? 0
        : days;
  const targetDay = addDays(eventAt, signedDays);
  return localDateTimeToUtc(dateISOInTz(targetDay, timezone), time.slice(0, 5), timezone);
}

/**
 * Chave de deduplicação do disparo.
 *
 * Para lembrete de agenda a chave é a OCORRÊNCIA — agendamento + dia —, não o
 * agendamento. Com `appointment:{id}` puro, remarcar o horário deixava a
 * cliente com o aviso ERRADO: o lembrete das 14h de terça já constava como
 * "enviado", e o horário novo de quinta nunca era avisado.
 *
 * A data entra na chave em vez de o remarcar invalidar o disparo pendente
 * porque a data é DERIVADA do estado atual do agendamento: funciona igual para
 * a remarcação pela agenda, pela ferramenta do agente de IA e por qualquer
 * caminho futuro que mexa em `starts_at`, sem depender de ninguém lembrar de
 * chamar um gancho. Invalidar exigiria um gancho em cada um desses lugares — e
 * o dia em que um deles for esquecido, o defeito volta calado.
 *
 * `after_appointment` e `after_purchase` ficam de fora: ancoram em fato
 * passado (atendimento concluído, pagamento) que não muda de data. E
 * `appointment_created` também: é confirmação de criação, dispara uma vez só e
 * remarcar não cria um agendamento novo.
 */
/**
 * Ponte com a chave antiga, durante a virada de versão.
 *
 * INCIDENTE OBSERVADO (24/08, conta 550): a migração reescreveu a chave dos
 * disparos já enviados para o formato com data enquanto uma versão ANTIGA do
 * serviço ainda rodava. Para ela a chave `appointment` sumiu, o lembrete
 * pareceu nunca enviado e duas mensagens repetidas saíram para uma cliente real
 * (disparos 2967 e 2968). O caminho inverso é igualmente possível: a versão
 * nova encontrar só a linha antiga e mandar de novo.
 *
 * Por isso, antes de reservar um lembrete de agenda, procura-se também a linha
 * na escrita antiga PARA A MESMA OCORRÊNCIA — mesma regra, mesmo agendamento e
 * mesmo instante de vencimento. Se ela existe, a mensagem já saiu.
 *
 * É um degrau de transição: a janela de reenvio é de um dia, então linhas
 * antigas deixam de importar ~48h depois de a versão nova estar no ar, e este
 * bloco pode sair. Enquanto ele existe, o custo é uma leitura indexada por
 * candidato vencido.
 */
async function jaEnviadoNaChaveAntiga(ruleId: number, sourceId: number, due: Date): Promise<boolean> {
  const [linha] = await db
    .select({ id: automationDispatches.id })
    .from(automationDispatches)
    .where(
      and(
        eq(automationDispatches.ruleId, ruleId),
        eq(automationDispatches.sourceType, "appointment"),
        eq(automationDispatches.sourceId, sourceId),
        eq(automationDispatches.scheduledFor, due),
      ),
    )
    .limit(1);
  return Boolean(linha);
}

export function automationDedupeKey(
  trigger: AutomationTrigger,
  candidate: Pick<Candidate, "sourceType" | "eventAt">,
  timezone: string,
): string {
  if (trigger === "before_appointment" || trigger === "appointment_day") {
    return `appointment:${dateISOInTz(candidate.eventAt, timezone)}`;
  }
  return candidate.sourceType;
}

export function renderAutomationTemplate(
  template: string,
  candidate: Candidate,
  timezone: string,
  bookingUrl: string,
) {
  const firstName = candidate.customerName.trim().split(/\s+/)[0] ?? candidate.customerName;
  const values: Record<string, string> = {
    nome: firstName,
    cliente: candidate.customerName,
    servico: candidate.serviceName ?? "seu atendimento",
    profissional: candidate.professionalName ?? "nossa equipe",
    data: formatTz(candidate.eventAt, timezone, "dd/MM/yyyy"),
    hora: formatTz(candidate.eventAt, timezone, "HH:mm"),
    link_agendamento: bookingUrl,
  };
  return template.replace(/\{(nome|cliente|servico|profissional|data|hora|link_agendamento)\}/g, (_, key) => values[key]);
}

// ---------------------------------------------------------------------------
// Varredura de candidatos
// ---------------------------------------------------------------------------

/**
 * Tamanho da página e teto de páginas da varredura.
 *
 * O corte anterior era um `.limit(500)` SEM `orderBy` numa janela de ±120 dias:
 * o Postgres devolvia as 500 linhas que quisesse, então um salão com mais de
 * 500 atendimentos na janela perdia lembretes ALEATORIAMENTE — e o conjunto
 * perdido mudava a cada varredura. Paginar por `id` crescente (chave estável,
 * sem o pulo de linha que `offset` sofre quando o conjunto muda no meio) torna
 * o percurso completo e repetível. O teto de páginas existe só para uma consulta
 * doente não consumir a memória do processo; ele avisa no log quando encosta.
 */
const PAGINA = 500;
const MAX_PAGINAS = 40;

/** Percorre uma consulta paginada por chave crescente até o fim (ou o teto). */
async function varrerPaginado<T extends { sourceId: number }>(
  rotulo: string,
  pagina: (depoisDoId: number) => Promise<T[]>,
): Promise<T[]> {
  const todos: T[] = [];
  let depoisDoId = 0;
  for (let p = 0; p < MAX_PAGINAS; p += 1) {
    const linhas = await pagina(depoisDoId);
    todos.push(...linhas);
    if (linhas.length < PAGINA) return todos;
    depoisDoId = linhas[linhas.length - 1].sourceId;
  }
  console.warn(`[automações] varredura de ${rotulo} atingiu ${MAX_PAGINAS} páginas (${todos.length} linhas); há candidatos além deste ponto`);
  return todos;
}

async function candidatesForRule(
  rule: typeof automationRules.$inferSelect,
  now: Date,
  timezone: string,
): Promise<Candidate[]> {
  // Janela larga o bastante para recuperar envios depois de uma indisponibilidade,
  // sem varrer o histórico inteiro a cada 30 segundos.
  const since = addDays(now, -120);
  const until = addDays(now, 120);
  if (rule.trigger === "birthday_before" || rule.trigger === "birthday_day") {
    const rows = await varrerPaginado("aniversários", (depoisDoId) =>
      db
        .select({
          sourceId: customers.id,
          customerId: customers.id,
          customerName: customers.name,
          consentMarketing: customers.consentMarketing,
          birthdate: customers.birthdate,
        })
        .from(customers)
        .where(
          and(
            eq(customers.organizationId, rule.organizationId),
            isNotNull(customers.birthdate),
            gt(customers.id, depoisDoId),
          ),
        )
        .orderBy(asc(customers.id))
        .limit(PAGINA),
    );
    const currentYear = Number(dateISOInTz(now, timezone).slice(0, 4));
    const candidates: Candidate[] = [];
    for (const row of rows) {
      const match = String(row.birthdate).match(/^\d{4}-(\d{2})-(\d{2})$/);
      if (!match) continue;
      const month = Number(match[1]);
      const originalDay = Number(match[2]);
      for (const year of [currentYear - 1, currentYear, currentYear + 1]) {
        // 29/02 cai em 28/02 nos anos não bissextos, em vez de desaparecer.
        const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
        const day = Math.min(originalDay, lastDay);
        const birthdayISO = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const eventAt = localDateTimeToUtc(birthdayISO, "12:00", timezone);
        candidates.push({
          sourceType: `birthday:${year}`,
          sourceId: row.sourceId,
          customerId: row.customerId,
          customerName: row.customerName,
          consentMarketing: row.consentMarketing,
          eventAt,
        });
      }
    }
    return candidates;
  }
  if (rule.trigger === "after_purchase") {
    const rows = await varrerPaginado("pagamentos", (depoisDoId) =>
      db
        .select({
          sourceId: payments.id,
          customerId: customers.id,
          customerName: customers.name,
          consentMarketing: customers.consentMarketing,
          eventAt: payments.paidAt,
        })
        .from(payments)
        .innerJoin(customers, eq(customers.id, payments.customerId))
        .where(
          and(
            eq(payments.organizationId, rule.organizationId),
            gte(payments.paidAt, since),
            lte(payments.paidAt, now),
            gt(payments.id, depoisDoId),
          ),
        )
        .orderBy(asc(payments.id))
        .limit(PAGINA),
    );
    // Só a compra confirmada mais recente de cada cliente pode reativá-la.
    const maisRecentes = [...rows].sort((a, b) => (b.eventAt?.getTime() ?? 0) - (a.eventAt?.getTime() ?? 0));
    const seen = new Set<number>();
    return maisRecentes
      .filter((row) => row.customerId && !seen.has(row.customerId) && seen.add(row.customerId))
      .map((row) => ({ ...row, customerId: row.customerId!, sourceType: "payment" as const }));
  }

  /**
   * `after_appointment` carrega TRÊS situações de propósito.
   *
   * As concluídas são os candidatos; as marcadas e confirmadas entram para
   * EXCLUIR quem já tem horário à frente. Sem elas, quem passou no salão há
   * 21 dias e já tem hora marcada para a semana que vem recebe um "sentimos sua
   * falta" — a mensagem mais constrangedora que a clínica pode mandar, e a que
   * mais rápido faz a dona desligar as automações. Vêm na mesma varredura para
   * não pagar uma segunda passagem pela mesma tabela.
   */
  const statuses =
    rule.trigger === "after_appointment"
      ? (["completed", "scheduled", "confirmed"] as const)
      : (["scheduled", "confirmed"] as const);
  const rows = await varrerPaginado("agendamentos", (depoisDoId) =>
    db
      .select({
        sourceId: appointments.id,
        status: appointments.status,
        customerId: customers.id,
        customerName: customers.name,
        consentMarketing: customers.consentMarketing,
        eventAt: appointments.startsAt,
        serviceName: services.name,
        professionalName: professionals.name,
      })
      .from(appointments)
      .innerJoin(customers, eq(customers.id, appointments.customerId))
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .innerJoin(professionals, eq(professionals.id, appointments.professionalId))
      .where(
        and(
          eq(appointments.organizationId, rule.organizationId),
          inArray(appointments.status, [...statuses]),
          gte(appointments.startsAt, since),
          lte(appointments.startsAt, until),
          gt(appointments.id, depoisDoId),
        ),
      )
      .orderBy(asc(appointments.id))
      .limit(PAGINA),
  );

  /** A situação só serve para separar candidato de exclusão; não vai adiante. */
  const paraCandidato = (row: (typeof rows)[number]): Candidate => ({
    sourceType: "appointment",
    sourceId: row.sourceId,
    customerId: row.customerId,
    customerName: row.customerName,
    consentMarketing: row.consentMarketing,
    eventAt: row.eventAt,
    serviceName: row.serviceName,
    professionalName: row.professionalName,
  });

  if (rule.trigger !== "after_appointment") return rows.map(paraCandidato);

  const comHorarioFuturo = new Set(
    rows.filter((row) => row.status !== "completed" && row.eventAt > now).map((row) => row.customerId),
  );
  const concluidos = rows.filter((row) => row.status === "completed").map(paraCandidato);

  // "Depois do último atendimento": se houve outro mais recente, o antigo
  // deixa de ser elegível e não gera uma reativação fora de contexto.
  concluidos.sort((a, b) => b.eventAt.getTime() - a.eventAt.getTime());
  const seen = new Set<number>();
  return concluidos.filter((row) => {
    if (comHorarioFuturo.has(row.customerId)) return false;
    if (seen.has(row.customerId)) return false;
    seen.add(row.customerId);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Vazão: o que impede a rajada que derruba o número da clínica
// ---------------------------------------------------------------------------

/**
 * Quantas mensagens automáticas uma conta pode disparar por varredura.
 *
 * O teto por hora de conversas NOVAS (`MAX_CONVERSAS_NOVAS_POR_HORA`, no
 * serviço de conversa ativa) não cobre tudo: quem já conversou com a clínica
 * antes não abre conversa nova e passa por fora dele. Uma automação de
 * aniversário num salão com base grande manda tudo em rajada por esse caminho,
 * e é rajada que faz o WhatsApp bloquear o número — o que derruba o Inbox
 * inteiro da cliente, não só a campanha.
 */
export const MAX_AUTOMACOES_POR_CICLO = 5;
/**
 * Teto por hora e por conta da VARREDURA, somando envio novo e retentativa.
 *
 * Sessenta mensagens por hora entrega o dia de um salão movimentado com folga
 * (as regras disparam num horário só, e o excedente sai nas varreduras
 * seguintes) e fica muito abaixo do volume que caracteriza disparo em massa. O
 * atraso é o comportamento desejado: lembrete que sai 40 minutos depois cumpre
 * a função; número bloqueado não cumpre nenhuma.
 *
 * A confirmação imediata do agendamento (`appointment_created`) fica FORA deste
 * teto de propósito: ela é uma mensagem por ação humana, sai no mesmo instante
 * ou perde o sentido, e segurá-la aqui só deixaria a linha reservada sem envio —
 * o claim órfão que a varredura teria de destravar depois. O freio dela é o teto
 * de conversas novas por hora (`MAX_CONVERSAS_NOVAS_POR_HORA`, no serviço de
 * conversa ativa), que é o que protege o número contra desconhecidos.
 */
export const MAX_AUTOMACOES_POR_HORA = 60;

/** Espaçamento entre duas mensagens automáticas. */
export const PAUSA_MIN_MS = 2_000;
export const PAUSA_MAX_MS = 5_000;

/** Intervalo sorteado: cadência humana não é metronômica, e o provedor olha para isso. */
function pausaAleatoria(): number {
  return Math.round(PAUSA_MIN_MS + Math.random() * (PAUSA_MAX_MS - PAUSA_MIN_MS));
}

const dormir = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Quantos envios ainda cabem na hora desta conta.
 *
 * A janela é medida por `last_attempt_at` (quando a mensagem SAIU) e não por
 * `created_at` (quando a linha nasceu). A retentativa é um UPDATE no registro
 * que já existe — a data de criação não anda — então, contando por ela, uma
 * fila de falhas represada durante uma queda do provedor voltava toda de uma
 * vez com o teto lendo zero: 5 por ciclo a cada 30 segundos são 600 mensagens
 * por hora saindo por baixo de um limite de 60. Verificado contra o Postgres:
 * com 60 linhas criadas há duas horas e reenviadas há dez minutos, a contagem
 * por `created_at` devolvia 0 e a 61ª mensagem saía.
 */
async function orcamentoDaConta(organizationId: number, now: Date): Promise<number> {
  const desde = new Date(now.getTime() - 3_600_000);
  const [linha] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(automationDispatches)
    .where(
      and(
        eq(automationDispatches.organizationId, organizationId),
        gte(automationDispatches.lastAttemptAt, desde),
        inArray(automationDispatches.status, ["sent", "processing"]),
      ),
    );
  const usadas = linha?.total ?? 0;
  return Math.max(0, Math.min(MAX_AUTOMACOES_POR_CICLO, MAX_AUTOMACOES_POR_HORA - usadas));
}

// ---------------------------------------------------------------------------
// Retentativa
// ---------------------------------------------------------------------------

/** Quantas vezes um disparo é tentado antes de a varredura desistir dele. */
export const MAX_TENTATIVAS = 5;
/** Claim sem desfecho por mais que isto = processo morreu entre o claim e o envio. */
const ORFAO_MINUTOS = 10;
/**
 * Passado isto, a mensagem não é mais verdade e insistir faz mal: um lembrete
 * de "amanhã às 14h" entregue meio dia depois confunde mais do que ajuda.
 */
const VALIDADE_HORAS = 12;

/**
 * Falhas que NÃO melhoram com insistência.
 *
 * `ENVIO_INCERTO` está aqui por um motivo diferente dos outros: nele o provedor
 * ACEITOU a mensagem e a cliente já recebeu. Retentar seria mandar de novo — o
 * defeito que esta frente inteira existe para eliminar.
 */
const CODIGOS_DEFINITIVOS: StartErrorCode[] = [
  "ENVIO_INCERTO",
  "SEM_WHATSAPP",
  "TELEFONE_INVALIDO",
  "CLIENTE_SEM_TELEFONE",
  "CLIENTE_NAO_ENCONTRADA",
  "NOME_OBRIGATORIO",
  "MENSAGEM_VAZIA",
];

/** Recuo progressivo: 5min, 15min, 45min, 2h15. */
const RECUO_BASE_MINUTOS = 5;

/** Lista dos códigos definitivos como fragmento SQL, para usar em `not in (...)`. */
const codigosDefinitivosSql = () =>
  sql.join(
    CODIGOS_DEFINITIVOS.map((codigo) => sql`${codigo}`),
    sql`, `,
  );

type Envio = {
  dispatchId: number;
  organizationId: number;
  customerId: number;
  message: string;
};

/**
 * Fecha o que não vai mais a lugar nenhum, para a tela não mentir.
 *
 * Duas situações: o claim órfão (linha em `processing` cujo processo morreu
 * entre a reserva e o envio — o índice único impede outro ciclo de reservá-la
 * de novo, então ela ficaria "em andamento" para sempre) e o disparo vencido,
 * que passou da validade. Os dois viram `failed` com motivo escrito, porque
 * "não enviamos" é informação que a dona precisa ter.
 */
async function encerrarDisparosVencidos(now: Date, organizationId?: number): Promise<number> {
  const orfaoAte = new Date(now.getTime() - ORFAO_MINUTOS * 60_000);
  const validoDesde = new Date(now.getTime() - VALIDADE_HORAS * 3_600_000);
  const encerrados = await db
    .update(automationDispatches)
    .set({
      status: "failed",
      error: "Não enviamos: a mensagem perdeu a validade antes de conseguirmos entregar.",
      errorCode: "EXPIRADO",
    })
    .where(
      and(
        inArray(automationDispatches.status, ["processing", "failed"]),
        lte(automationDispatches.scheduledFor, validoDesde),
        lte(automationDispatches.lastAttemptAt, orfaoAte),
        // `is distinct from` porque `<>` com NULL não devolve verdadeiro, e o
        // disparo que ainda não tem código é justamente o que precisa fechar.
        sql`${automationDispatches.errorCode} is distinct from 'EXPIRADO'`,
        /**
         * Falha já diagnosticada fica com o motivo dela.
         *
         * Este UPDATE reescreve `error` e `error_code`; sem esta linha, doze
         * horas depois TODA falha vira "perdeu a validade" na tela — inclusive
         * `ENVIO_INCERTO`, que é o único desfecho em que a cliente JÁ recebeu.
         * Apagar esse código apaga justamente o fato que impede alguém de
         * reenviar à mão e mandar a mesma mensagem duas vezes. Códigos
         * definitivos já não são retentados, então fechá-los aqui não muda o
         * envio: só troca a verdade por uma frase genérica.
         */
        sql`(${automationDispatches.errorCode} is null or ${automationDispatches.errorCode} not in (${codigosDefinitivosSql()}))`,
        ...(organizationId ? [eq(automationDispatches.organizationId, organizationId)] : []),
      ),
    )
    .returning({ id: automationDispatches.id });
  return encerrados.length;
}

/**
 * Reivindica disparos para nova tentativa, com UPDATE no registro que já existe.
 *
 * Tem de ser UPDATE, e não INSERT: o índice único `(rule_id, source_type,
 * source_id)` é justamente o que garante uma mensagem por ocorrência, então uma
 * linha nova seria recusada — era por isso que um disparo falho morria ali,
 * para sempre. A reserva e o incremento de `attempts` acontecem na MESMA
 * instrução para que dois processos não peguem a mesma linha.
 */
async function reivindicarRetentativas(
  organizationId: number,
  now: Date,
  limite: number,
): Promise<Envio[]> {
  if (limite <= 0) return [];
  const validoDesde = new Date(now.getTime() - VALIDADE_HORAS * 3_600_000);
  const orfaoAte = new Date(now.getTime() - ORFAO_MINUTOS * 60_000);
  const definitivos = codigosDefinitivosSql();
  const { rows } = await db.execute<{
    id: string | number;
    organization_id: string | number;
    customer_id: string | number;
    message: string;
  }>(sql`
    UPDATE automation_dispatches
    SET status = 'processing', attempts = attempts + 1, last_attempt_at = ${now},
        error = NULL, error_code = NULL, error_detail = NULL
    WHERE id IN (
      SELECT d.id FROM automation_dispatches d
      WHERE d.organization_id = ${organizationId}
        AND attempts < ${MAX_TENTATIVAS}
        AND scheduled_for > ${validoDesde}
        -- Pausar a automação tem de parar TUDO que ela geraria, inclusive a
        -- insistência em cima do que já estava reservado. Sem isto, "Pausar"
        -- silenciaria só os disparos novos.
        AND EXISTS (SELECT 1 FROM automation_rules r WHERE r.id = d.rule_id AND r.active)
        AND (
          (status = 'failed'
            AND (error_code IS NULL OR error_code NOT IN (${definitivos}))
            AND last_attempt_at <= ${now}::timestamptz - (interval '1 minute' * ${RECUO_BASE_MINUTOS} * power(3, attempts - 1)))
          OR (status = 'processing' AND last_attempt_at <= ${orfaoAte})
        )
      ORDER BY scheduled_for ASC
      LIMIT ${limite}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, organization_id, customer_id, message
  `);
  return rows.map((row) => ({
    dispatchId: Number(row.id),
    organizationId: Number(row.organization_id),
    customerId: Number(row.customer_id),
    message: row.message,
  }));
}

/** Grava o desfecho do envio no registro reservado. */
/**
 * `now` é o relógio DA VARREDURA, não o do sistema.
 *
 * `lastAttemptAt` é o que o recuo progressivo compara na varredura seguinte;
 * gravá-lo com um relógio diferente do usado na comparação faria o recuo medir
 * duas linhas do tempo e retentar antes da hora.
 */
async function registrarDesfecho(
  dispatchId: number,
  resultado: Awaited<ReturnType<typeof startOutboundConversation>>,
  now: Date,
): Promise<void> {
  await db
    .update(automationDispatches)
    .set(
      resultado.ok
        ? { status: "sent", sentAt: now, lastAttemptAt: now, error: null, errorCode: null, errorDetail: null }
        : {
            status: "failed",
            lastAttemptAt: now,
            error: resultado.error.slice(0, 500),
            errorCode: resultado.code,
            errorDetail: resultado.detail?.slice(0, 1000) ?? null,
          },
    )
    .where(eq(automationDispatches.id, dispatchId));
}

// ---------------------------------------------------------------------------
// Disparo
// ---------------------------------------------------------------------------

/**
 * Dispara a confirmação operacional logo após o commit do agendamento.
 * O livro-razão torna a operação idempotente, inclusive se uma rota repetir a chamada.
 */
export async function dispatchAppointmentCreatedAutomations(ctx: TenantContext, appointmentId: number) {
  const rules = await db
    .select()
    .from(automationRules)
    .where(
      and(
        eq(automationRules.organizationId, ctx.organizationId),
        eq(automationRules.trigger, "appointment_created"),
        eq(automationRules.active, true),
      ),
    );
  if (!rules.length) return;

  const [row] = await db
    .select({
      sourceId: appointments.id,
      customerId: customers.id,
      customerName: customers.name,
      consentMarketing: customers.consentMarketing,
      eventAt: appointments.startsAt,
      serviceName: services.name,
      professionalName: professionals.name,
    })
    .from(appointments)
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(professionals, eq(professionals.id, appointments.professionalId))
    .where(and(eq(appointments.id, appointmentId), eq(appointments.organizationId, ctx.organizationId)))
    .limit(1);
  if (!row) return;

  const candidate: Candidate = { ...row, sourceType: "appointment" };
  const bookingUrl = `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/agendar/${ctx.organizationSlug}`;
  for (const rule of rules) {
    const message = renderAutomationTemplate(rule.messageTemplate, candidate, ctx.timezone, bookingUrl);
    const now = new Date();
    const [claimed] = await db
      .insert(automationDispatches)
      .values({
        organizationId: ctx.organizationId,
        ruleId: rule.id,
        customerId: candidate.customerId,
        sourceType: automationDedupeKey(rule.trigger, candidate, ctx.timezone),
        sourceId: candidate.sourceId,
        scheduledFor: now,
        lastAttemptAt: now,
        message,
      })
      .onConflictDoNothing()
      .returning({ id: automationDispatches.id });
    if (!claimed) continue;

    const result = await startOutboundConversation(ctx, { customerId: candidate.customerId, body: message, automated: true });
    await registrarDesfecho(claimed.id, result, now);
  }
}

async function automationContext(organizationId: number): Promise<TenantContext | null> {
  const [row] = await db
    .select({
      organizationId: organizations.id,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
      organizationCode: organizations.publicId,
      timezone: organizations.timezone,
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
      role: organizationMembers.role,
    })
    .from(organizations)
    .innerJoin(organizationMembers, eq(organizationMembers.organizationId, organizations.id))
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizations.id, organizationId), inArray(organizationMembers.role, ["owner", "admin"])))
    .orderBy(asc(organizationMembers.id))
    .limit(1);
  return row ?? null;
}

export type DispatchSweepResult = {
  sent: number;
  failed: number;
  skipped: number;
  /** Tentados de novo depois de falha ou de claim órfão. */
  retried: number;
  /** Vencidos: prontos para enviar, mas segurados pelo teto de vazão. */
  postponed: number;
  /** Fechados por validade (não vão mais ser enviados). */
  expired: number;
};

/** Uma varredura por vez neste processo: as pausas fazem o ciclo durar mais que o intervalo do worker. */
let varreduraEmCurso = false;

type SweepOptions = {
  /** Injetável para o teste não gastar segundos reais esperando a cadência. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Restringe a varredura a uma conta.
   *
   * O worker não passa nada e varre tudo, como sempre. Serve para reprocessar
   * uma conta específica sem mexer nas outras — e é o que permite testar a
   * varredura num banco compartilhado sem escrever na conta de ninguém.
   */
  organizationId?: number;
};

/**
 * Envia regras vencidas; seguro para múltiplas réplicas e reinicializações.
 *
 * A ordem é deliberada: primeiro fecha o que venceu, depois retoma o que falhou
 * (mais antigo primeiro) e só então procura candidatos novos — um lembrete que
 * já deveria ter saído tem precedência sobre um que acabou de vencer.
 */
export async function dispatchDueAutomations(now = new Date(), options: SweepOptions = {}): Promise<DispatchSweepResult> {
  const resultado: DispatchSweepResult = { sent: 0, failed: 0, skipped: 0, retried: 0, postponed: 0, expired: 0 };
  if (varreduraEmCurso) return resultado;
  varreduraEmCurso = true;
  const sleep = options.sleep ?? dormir;
  const soDaConta = options.organizationId;
  try {
    resultado.expired = await encerrarDisparosVencidos(now, soDaConta);

    const rules = await db
      .select()
      .from(automationRules)
      .where(
        soDaConta
          ? and(eq(automationRules.active, true), eq(automationRules.organizationId, soDaConta))
          : eq(automationRules.active, true),
      );
    const pendentes = await db
      .selectDistinct({ organizationId: automationDispatches.organizationId })
      .from(automationDispatches)
      .where(
        soDaConta
          ? and(
              inArray(automationDispatches.status, ["failed", "processing"]),
              eq(automationDispatches.organizationId, soDaConta),
            )
          : inArray(automationDispatches.status, ["failed", "processing"]),
      );
    const contas = [...new Set([...rules.map((r) => r.organizationId), ...pendentes.map((p) => p.organizationId)])];

    for (const organizationId of contas) {
      const ctx = await automationContext(organizationId);
      if (!ctx) continue;
      let orcamento = await orcamentoDaConta(organizationId, now);
      let jaEnviouNesteCiclo = false;

      /** Envia respeitando a cadência; a primeira mensagem do ciclo não espera. */
      const enviar = async (envio: Envio) => {
        if (jaEnviouNesteCiclo) await sleep(pausaAleatoria());
        jaEnviouNesteCiclo = true;
        const result = await startOutboundConversation(ctx, {
          customerId: envio.customerId,
          body: envio.message,
          automated: true,
        });
        await registrarDesfecho(envio.dispatchId, result, now);
        if (result.ok) resultado.sent += 1;
        else resultado.failed += 1;
        orcamento -= 1;
      };

      for (const envio of await reivindicarRetentativas(organizationId, now, orcamento)) {
        resultado.retried += 1;
        await enviar(envio);
      }

      for (const rule of rules.filter((r) => r.organizationId === organizationId)) {
        if (rule.trigger === "appointment_created") continue;
        const candidates = await candidatesForRule(rule, now, ctx.timezone);
        const bookingUrl = `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/agendar/${ctx.organizationSlug}`;

        // Mais atrasado primeiro: quando o teto corta a fila, quem espera há
        // mais tempo é quem passa.
        const vencidos = candidates
          .map((candidate) => ({
            candidate,
            due: automationScheduledFor(candidate.eventAt, rule.trigger, rule.daysOffset, rule.sendTime, ctx.timezone),
          }))
          .filter(({ candidate, due }) => {
            if (due > now || due < addDays(now, -1)) return false;
            if ((rule.trigger === "before_appointment" || rule.trigger === "appointment_day") && candidate.eventAt <= now) return false;
            return true;
          })
          .sort((a, b) => a.due.getTime() - b.due.getTime());

        for (const { candidate, due } of vencidos) {
          // Reativação é marketing; lembrete operacional de agenda não é.
          const precisaConsentimento =
            rule.trigger === "after_appointment" ||
            rule.trigger === "after_purchase" ||
            rule.trigger === "birthday_before" ||
            rule.trigger === "birthday_day";
          const message = renderAutomationTemplate(rule.messageTemplate, candidate, ctx.timezone, bookingUrl);
          const sourceType = automationDedupeKey(rule.trigger, candidate, ctx.timezone);

          // Quem não enviou não gasta vazão: a recusa por consentimento é
          // registrada antes do teto para não roubar a vez de quem vai receber.
          if (precisaConsentimento && !candidate.consentMarketing) {
            const [reservado] = await db
              .insert(automationDispatches)
              .values({
                organizationId: rule.organizationId,
                ruleId: rule.id,
                customerId: candidate.customerId,
                sourceType,
                sourceId: candidate.sourceId,
                scheduledFor: due,
                lastAttemptAt: now,
                message,
                status: "skipped",
                error: "Cliente sem consentimento de marketing.",
                errorCode: "SEM_CONSENTIMENTO",
              })
              .onConflictDoNothing()
              .returning({ id: automationDispatches.id });
            if (reservado) resultado.skipped += 1;
            continue;
          }

          if (
            (rule.trigger === "before_appointment" || rule.trigger === "appointment_day") &&
            (await jaEnviadoNaChaveAntiga(rule.id, candidate.sourceId, due))
          ) {
            continue;
          }

          if (orcamento <= 0) {
            // Nada é reservado aqui: uma linha reservada e não enviada é
            // exatamente o claim órfão que a varredura precisa depois limpar.
            resultado.postponed += 1;
            continue;
          }

          const [claimed] = await db
            .insert(automationDispatches)
            .values({
              organizationId: rule.organizationId,
              ruleId: rule.id,
              customerId: candidate.customerId,
              sourceType,
              sourceId: candidate.sourceId,
              scheduledFor: due,
              lastAttemptAt: now,
              message,
            })
            .onConflictDoNothing()
            .returning({ id: automationDispatches.id });
          if (!claimed) continue;

          await enviar({
            dispatchId: claimed.id,
            organizationId: rule.organizationId,
            customerId: candidate.customerId,
            message,
          });
        }
      }
    }
    return resultado;
  } finally {
    varreduraEmCurso = false;
  }
}

// ---------------------------------------------------------------------------
// Leitura para a tela
// ---------------------------------------------------------------------------

export type AutomationDispatchRow = {
  id: number;
  status: "processing" | "sent" | "failed" | "skipped";
  attempts: number;
  customerName: string;
  ruleName: string;
  message: string;
  scheduledFor: Date;
  sentAt: Date | null;
  error: string | null;
  errorDetail: string | null;
};

/**
 * Últimos disparos da conta.
 *
 * Existe porque, sem tela, um lembrete que falha some: a dona do salão acredita
 * que a cliente foi avisada, a cliente não foi, e ninguém descobre até o
 * horário vago.
 */
export async function listRecentDispatches(ctx: TenantContext, limit = 25): Promise<AutomationDispatchRow[]> {
  const rows = await db
    .select({
      id: automationDispatches.id,
      status: automationDispatches.status,
      attempts: automationDispatches.attempts,
      customerName: customers.name,
      ruleName: automationRules.name,
      message: automationDispatches.message,
      scheduledFor: automationDispatches.scheduledFor,
      sentAt: automationDispatches.sentAt,
      error: automationDispatches.error,
      errorDetail: automationDispatches.errorDetail,
    })
    .from(automationDispatches)
    .innerJoin(customers, eq(customers.id, automationDispatches.customerId))
    .innerJoin(automationRules, eq(automationRules.id, automationDispatches.ruleId))
    .where(eq(automationDispatches.organizationId, ctx.organizationId))
    .orderBy(desc(automationDispatches.id))
    .limit(limit);
  return rows;
}

/**
 * Exposto só para teste: a varredura de candidatos é onde mora o corte cego
 * (limite sem ordenação) e a exclusão de quem já tem horário marcado, e testar
 * isso pelo `dispatchDueAutomations` seria testar através do teto de vazão.
 */
export const _internals = { candidatesForRule, ehConflitoDeGatilho };
