import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { paymentProviderKind, paymentProviders, platformCharges, platformWebhookEvents } from "@/db/schema";
import type { PlatformContext } from "@/server/platform-auth";

/**
 * Provedores de pagamento da plataforma e a entrada do webhook da Hotmart.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTÁ PRONTO E O QUE ESTÁ PENDENTE — leia antes de mexer
 * ─────────────────────────────────────────────────────────────────────────────
 * PRONTO: cadastro do provedor, guarda do hottok como HASH (o valor cru nunca
 * é gravado nem devolvido para a tela), validação do hottok que chega no
 * webhook e registro BRUTO de toda entrega em `platform_webhook_events`.
 *
 * PENDENTE, de propósito: o processamento de assinatura. Faltam duas coisas
 * que só o Bruno pode dar:
 *   1. o hottok do painel da Hotmart;
 *   2. o mapa de produto/oferta da Hotmart → plano daqui (`plans.slug`), sem o
 *      qual não existe como saber que "compra aprovada do produto 1234040" é
 *      uma assinatura do plano Essencial no ciclo mensal.
 *
 * Enquanto o mapa não existir, `processHotmartEvent` marca o evento como NÃO
 * processado com o motivo escrito por extenso e não toca em `subscriptions`.
 * Inventar uma assinatura aqui seria pior do que não processar: o painel
 * reconstrói o movimento de MRR a partir de `subscription_events`, então uma
 * assinatura chutada vira receita fantasma no gráfico — e receita fantasma não
 * dá erro, só mente. O payload fica guardado inteiro; quando o mapa chegar,
 * dá para reprocessar tudo que já entrou.
 *
 * Quando o processamento for escrito, a regra inegociável vale aqui também:
 * toda mutação de assinatura grava um `subscription_events` na MESMA transação,
 * com `mrrBeforeCents`/`mrrAfterCents` normalizados em mensal (anual conta como
 * `round(priceCents / 12)`; `trialing` e `canceled` valem zero).
 */

export type PaymentProviderKind = (typeof paymentProviderKind.enumValues)[number];

export const PROVIDER_KINDS = [
  "hotmart",
  "hubla",
  "kiwify",
  "asaas",
  "pagarme",
  "cakto",
  "stripe",
  "manual",
] as const satisfies readonly PaymentProviderKind[];

export const PROVIDER_LABELS: Record<PaymentProviderKind, string> = {
  hotmart: "Hotmart",
  hubla: "Hubla",
  kiwify: "Kiwify",
  asaas: "Asaas",
  pagarme: "Pagar.me",
  cakto: "Cakto",
  stripe: "Stripe",
  manual: "Manual (fora de provedor)",
};

/**
 * Hotmart, Hubla e Kiwify têm rota de webhook implementada. O resto está
 * cadastrável, não ligado — mesma régua da Hotmart antes de existir a rota
 * dela: aparece na tela, mas não recebe entrega nenhuma.
 */
export const KIND_WITH_WEBHOOK: PaymentProviderKind[] = ["hotmart", "hubla", "kiwify"];

export const HOTMART_WEBHOOK_PATH = "/api/webhooks/hotmart";
export const HUBLA_WEBHOOK_PATH = "/api/webhooks/hubla";
export const KIWIFY_WEBHOOK_PATH = "/api/webhooks/kiwify";

/** Endereço do webhook de cada provedor que sabe receber um. */
export const WEBHOOK_PATH: Partial<Record<PaymentProviderKind, string>> = {
  hotmart: HOTMART_WEBHOOK_PATH,
  hubla: HUBLA_WEBHOOK_PATH,
  kiwify: KIWIFY_WEBHOOK_PATH,
};

// ─── Segredo do webhook ──────────────────────────────────────────────────────

/**
 * O hottok vira hash na entrada e nunca sai daqui em claro.
 *
 * Ele não é uma assinatura HMAC do corpo (a Hotmart manda o mesmo token fixo em
 * toda entrega), então guardar o hash cumpre o único papel que ele tem: comparar
 * o que chega. Quem invadir o banco não sai com um token utilizável.
 */
export function hashWebhookToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

/** "••••3f2a" — o suficiente para conferir com o painel da Hotmart, e só. */
export function webhookTokenHint(token: string): string {
  const clean = token.trim();
  return clean.length <= 4 ? "••••" : `••••${clean.slice(-4)}`;
}

/**
 * Comparação em tempo constante entre o hash guardado e o hash do que chegou.
 *
 * Os dois são hex de sha256, então têm sempre 64 caracteres — mas o guard de
 * tamanho fica assim mesmo, porque `timingSafeEqual` lança se os buffers
 * divergirem e um provedor mal configurado não pode derrubar a rota.
 */
export function hottokMatches(storedHash: string | null, token: string | null): boolean {
  if (!storedHash || !token) return false;
  const incoming = Buffer.from(hashWebhookToken(token), "utf8");
  const stored = Buffer.from(storedHash, "utf8");
  if (incoming.length !== stored.length) return false;
  return timingSafeEqual(incoming, stored);
}

/**
 * Mesma comparação de `hottokMatches`, com nome que não amarra a um provedor
 * só — é a que a Hubla e a Kiwify usam. Ficou como alias, e não como rename de
 * `hottokMatches`, para não mexer na rota da Hotmart que já está em produção.
 */
export const webhookTokenMatches = hottokMatches;

/**
 * Onde procurar o token de cada provedor na entrega.
 *
 * `x-hubla-token` é a convenção CONFIRMADA da Hubla (doc oficial: Central de
 * Ajuda → Webhooks → Proteja seu endpoint — token estático, sem HMAC, mesmo
 * desenho do hottok da Hotmart). Os nomes genéricos que seguem cobrem a
 * Kiwify e qualquer outro provedor que venha depois, cuja convenção exata
 * ainda não foi confirmada contra uma conta de verdade — por isso a extração
 * tenta mais de um lugar plausível em vez de travar numa só. Recusa continua
 * sendo 401 seco em qualquer caso.
 */
export function extractWebhookToken(request: Request, payload: unknown): string | null {
  const headerNames = [
    "x-hubla-token",
    "x-webhook-token",
    "x-hub-token",
    "x-webhook-signature",
    "authorization",
  ];
  for (const name of headerNames) {
    const value = request.headers.get(name)?.trim();
    if (!value) continue;
    return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : value;
  }

  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("token") ?? url.searchParams.get("signature");
  if (fromQuery?.trim()) return fromQuery.trim();

  if (payload && typeof payload === "object") {
    const body = payload as Record<string, unknown>;
    for (const key of ["token", "webhook_token", "signature"]) {
      const value = body[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }

  return null;
}

/**
 * Identidade da entrega da Hubla — `x-hubla-idempotency` é o identificador
 * único de cada evento (doc oficial), mais confiável que tentar adivinhar um
 * campo no corpo. Cai para `extractExternalId` (id do corpo, ou hash do corpo
 * cru) quando o header não vem, para a rota não perder deduplicação por causa
 * de um provedor que manda o header em falta.
 */
export function extractHublaExternalId(request: Request, payload: unknown, rawBody: string): string {
  const idempotency = request.headers.get("x-hubla-idempotency")?.trim();
  if (idempotency) return idempotency;
  return extractExternalId(payload, rawBody);
}

/** `type` na Hubla, não `event`/`status` — por isso não reaproveita `extractEventName`. */
export function extractHublaEventName(payload: unknown): string | null {
  if (payload && typeof payload === "object") {
    const type = (payload as Record<string, unknown>).type;
    if (typeof type === "string" && type.trim()) return type.trim();
  }
  return null;
}

// ─── Leitura para a tela ─────────────────────────────────────────────────────

export type PaymentProviderView = {
  id: number;
  kind: PaymentProviderKind;
  name: string;
  enabled: boolean;
  /** Nunca o token: só a dica de quatro dígitos, ou null quando não há token. */
  webhookTokenHint: string | null;
  hasWebhookToken: boolean;
  lastEventAt: Date | null;
  createdAt: Date;
  /** Anotação livre do provedor (`config.note`), quando existir. */
  note: string | null;
};

// O contexto não é usado na consulta — o painel é cross-tenant, não há
// organizationId para filtrar. Ele fica na assinatura de propósito: exigir o
// contexto é o que obriga quem chama a ter passado por `requirePlatformAdmin`.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function listPaymentProviders(_ctx: PlatformContext): Promise<PaymentProviderView[]> {
  const rows = await db
    .select({
      id: paymentProviders.id,
      kind: paymentProviders.kind,
      name: paymentProviders.name,
      enabled: paymentProviders.enabled,
      webhookTokenHash: paymentProviders.webhookTokenHash,
      webhookTokenHint: paymentProviders.webhookTokenHint,
      config: paymentProviders.config,
      lastEventAt: paymentProviders.lastEventAt,
      createdAt: paymentProviders.createdAt,
    })
    .from(paymentProviders)
    .orderBy(desc(paymentProviders.enabled), paymentProviders.name);

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    enabled: row.enabled,
    webhookTokenHint: row.webhookTokenHint,
    hasWebhookToken: Boolean(row.webhookTokenHash),
    lastEventAt: row.lastEventAt,
    createdAt: row.createdAt,
    note: readNote(row.config),
  }));
}

export type WebhookEventView = {
  id: number;
  kind: PaymentProviderKind;
  eventName: string | null;
  externalId: string | null;
  receivedAt: Date;
  processedAt: Date | null;
  error: string | null;
};

export async function listWebhookEvents(
  _ctx: PlatformContext,
  limit = 20,
): Promise<WebhookEventView[]> {
  return db
    .select({
      id: platformWebhookEvents.id,
      kind: platformWebhookEvents.kind,
      eventName: platformWebhookEvents.eventName,
      externalId: platformWebhookEvents.externalId,
      receivedAt: platformWebhookEvents.receivedAt,
      processedAt: platformWebhookEvents.processedAt,
      error: platformWebhookEvents.error,
    })
    .from(platformWebhookEvents)
    .orderBy(desc(platformWebhookEvents.receivedAt))
    .limit(limit);
}

function readNote(config: unknown): string | null {
  if (!config || typeof config !== "object") return null;
  const note = (config as Record<string, unknown>).note;
  return typeof note === "string" && note.trim() ? note.trim() : null;
}

// ─── Escrita ─────────────────────────────────────────────────────────────────

export type SaveProviderInput = {
  /** Só na criação. Na edição o tipo é imutável: ele é a chave do webhook. */
  kind: PaymentProviderKind;
  name: string;
  enabled: boolean;
  /**
   * Token cru digitado agora. `undefined`/vazio mantém o que já está guardado —
   * a tela não tem como devolver o token para reenviá-lo.
   */
  webhookToken?: string;
  /** Apaga o token guardado. Um provedor sem token não valida webhook nenhum. */
  clearWebhookToken?: boolean;
};

export async function saveProvider(
  _ctx: PlatformContext,
  input: SaveProviderInput,
): Promise<PaymentProviderView> {
  const [existing] = await db
    .select()
    .from(paymentProviders)
    .where(eq(paymentProviders.kind, input.kind))
    .limit(1);

  const token = input.webhookToken?.trim();
  const tokenFields = input.clearWebhookToken
    ? { webhookTokenHash: null, webhookTokenHint: null }
    : token
      ? { webhookTokenHash: hashWebhookToken(token), webhookTokenHint: webhookTokenHint(token) }
      : {};

  // Ligar sem token é uma armadilha silenciosa: a tela fica verde e toda
  // entrega da Hotmart volta 401. Melhor recusar aqui do que descobrir depois.
  const willHaveToken = input.clearWebhookToken
    ? false
    : Boolean(token) || Boolean(existing?.webhookTokenHash);
  if (input.enabled && KIND_WITH_WEBHOOK.includes(input.kind) && !willHaveToken) {
    throw new Error("TOKEN_REQUIRED");
  }

  const [row] = existing
    ? await db
        .update(paymentProviders)
        .set({ name: input.name, enabled: input.enabled, ...tokenFields })
        .where(eq(paymentProviders.id, existing.id))
        .returning()
    : await db
        .insert(paymentProviders)
        .values({
          kind: input.kind,
          name: input.name,
          enabled: input.enabled,
          ...tokenFields,
        })
        .returning();

  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    enabled: row.enabled,
    webhookTokenHint: row.webhookTokenHint,
    hasWebhookToken: Boolean(row.webhookTokenHash),
    lastEventAt: row.lastEventAt,
    createdAt: row.createdAt,
    note: readNote(row.config),
  };
}

export type DeleteProviderResult = { ok: true } | { ok: false; error: string };

/**
 * Exclui o provedor — só quando ele nunca recebeu evento nem cobrança.
 *
 * `platform_webhook_events` e `platform_charges` apontam para o provedor por
 * id, e o índice de dedução de entrega (`kind`, `external_id`) e o histórico de
 * cobrança dependem dessa referência continuar existindo. Excluir um provedor
 * com histórico apagaria (ou órfãria) esse rastro; desligar (`enabled = false`)
 * já cumpre o papel de "parar de receber" sem perder nada.
 */
export async function deleteProvider(
  _ctx: PlatformContext,
  providerId: number,
): Promise<DeleteProviderResult> {
  const [provider] = await db
    .select({ id: paymentProviders.id, name: paymentProviders.name })
    .from(paymentProviders)
    .where(eq(paymentProviders.id, providerId))
    .limit(1);
  if (!provider) return { ok: false, error: "Este provedor não existe mais." };

  const [[{ total: events }], [{ total: charges }]] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` })
      .from(platformWebhookEvents)
      .where(eq(platformWebhookEvents.providerId, providerId)),
    db.select({ total: sql<number>`count(*)::int` })
      .from(platformCharges)
      .where(eq(platformCharges.providerId, providerId)),
  ]);
  if (events > 0 || charges > 0) {
    return {
      ok: false,
      error: `${provider.name} já tem ${events > 0 ? `${events} evento${events === 1 ? "" : "s"} de webhook` : ""}${events > 0 && charges > 0 ? " e " : ""}${charges > 0 ? `${charges} cobrança${charges === 1 ? "" : "s"}` : ""} no histórico. Desligue em vez de excluir — apagar perderia esse rastro.`,
    };
  }

  await db.delete(paymentProviders).where(eq(paymentProviders.id, providerId));
  return { ok: true };
}

// ─── Webhook: autenticação e registro ────────────────────────────────────────

export type WebhookProvider = typeof paymentProviders.$inferSelect;

/**
 * Provedor que atende o webhook. Devolve a linha mesmo desligada: quem decide
 * o que fazer com isso é a rota, que responde 401 sem distinguir "desligado" de
 * "não existe" — para quem bate na porta, os dois casos são o mesmo silêncio.
 */
export async function providerForWebhook(
  kind: PaymentProviderKind,
): Promise<WebhookProvider | null> {
  const [row] = await db
    .select()
    .from(paymentProviders)
    .where(eq(paymentProviders.kind, kind))
    .limit(1);
  return row ?? null;
}

/** O hottok vem no header em toda entrega recente; no corpo, nas antigas. */
export function extractHottok(headerValue: string | null, payload: unknown): string | null {
  const fromHeader = headerValue?.trim();
  if (fromHeader) return fromHeader;
  if (payload && typeof payload === "object") {
    const body = (payload as Record<string, unknown>).hottok;
    if (typeof body === "string" && body.trim()) return body.trim();
  }
  return null;
}

/** `event` na v2 da Hotmart; nas entregas antigas o nome vinha em `status`. */
export function extractEventName(payload: unknown): string | null {
  if (payload && typeof payload === "object") {
    const body = payload as Record<string, unknown>;
    for (const key of ["event", "status", "type"]) {
      const value = body[key];
      if (typeof value === "string" && value.trim()) return value.trim().toUpperCase();
    }
  }
  return null;
}

/**
 * Identidade da entrega, para deduplicar reenvio.
 *
 * A Hotmart reentrega o mesmo evento quando não recebe 200 rápido, e o índice
 * único (kind, external_id) é o que impede a mesma compra de ser processada
 * duas vezes. Quando o payload não traz identificador nenhum, o hash do corpo
 * cru serve de substituto: reenvio idêntico continua colidindo, e o índice não
 * fica com NULL (que no Postgres não colide com nada e furaria a dedução).
 */
export function extractExternalId(payload: unknown, rawBody: string): string {
  if (payload && typeof payload === "object") {
    const body = payload as Record<string, unknown>;
    const direct = body.id;
    if (typeof direct === "string" && direct.trim()) return direct.trim();

    const data = body.data;
    if (data && typeof data === "object") {
      const purchase = (data as Record<string, unknown>).purchase;
      if (purchase && typeof purchase === "object") {
        const transaction = (purchase as Record<string, unknown>).transaction;
        if (typeof transaction === "string" && transaction.trim()) return transaction.trim();
      }
    }

    const transaction = body.transaction;
    if (typeof transaction === "string" && transaction.trim()) return transaction.trim();
  }
  return `sha256:${createHash("sha256").update(rawBody).digest("hex")}`;
}

/** Sinal de vida do provedor. Falha aqui não pode derrubar a resposta 200. */
export async function touchProviderLastEvent(providerId: number, at: Date): Promise<void> {
  await db
    .update(paymentProviders)
    .set({ lastEventAt: at })
    .where(eq(paymentProviders.id, providerId));
}

// ─── Mapa de eventos → operação do domínio ───────────────────────────────────

/**
 * O que cada evento da Hotmart significa aqui dentro.
 *
 * `subscriptionEventKind` é o registro que a operação PRECISARÁ gravar em
 * `subscription_events` quando o processamento existir — está escrito agora
 * para que quem implementar não tenha que decidir de novo. Onde depende do
 * valor (troca de plano pode subir ou descer o MRR), o campo é null e a decisão
 * é do código, comparando o MRR antes e depois.
 */
export type HotmartOperation =
  | "start_or_convert_subscription"
  | "confirm_subscription"
  | "cancel_subscription"
  | "switch_plan";

export const HOTMART_EVENT_MAP: Record<
  string,
  { operation: HotmartOperation; subscriptionEventKind: string | null; description: string }
> = {
  PURCHASE_APPROVED: {
    operation: "start_or_convert_subscription",
    subscriptionEventKind: "created",
    description:
      "Compra aprovada: começa a assinatura, ou converte o teste que estava aberto (aí o registro é trial_converted).",
  },
  PURCHASE_COMPLETE: {
    operation: "confirm_subscription",
    subscriptionEventKind: "renewed",
    description:
      "Compra concluída depois do prazo de garantia. Confirma o período; não muda o valor da assinatura.",
  },
  SUBSCRIPTION_CANCELLATION: {
    operation: "cancel_subscription",
    subscriptionEventKind: "canceled",
    description: "Assinatura cancelada na Hotmart. MRR depois vai a zero.",
  },
  PURCHASE_REFUNDED: {
    operation: "cancel_subscription",
    subscriptionEventKind: "canceled",
    description: "Compra reembolsada. Encerra o acesso e zera o MRR.",
  },
  PURCHASE_CHARGEBACK: {
    operation: "cancel_subscription",
    subscriptionEventKind: "canceled",
    description: "Chargeback. Mesmo destino do reembolso, com motivo diferente.",
  },
  SWITCH_PLAN: {
    operation: "switch_plan",
    subscriptionEventKind: null,
    description:
      "Troca de plano ou de ciclo. Vira upgraded ou downgraded conforme o MRR normalizado suba ou desça.",
  },
};

export type ProcessOutcome = { processed: boolean; reason: string };

/**
 * Processamento da assinatura — deliberadamente PENDENTE.
 *
 * Ver o cabeçalho do arquivo. Aqui só se decide o que o evento SERIA, e o
 * evento é marcado como não processado com o motivo por extenso. Nada é
 * escrito em `subscriptions` nem em `subscription_events`.
 */
export async function processHotmartEvent(args: {
  eventId: number;
  eventName: string | null;
  provider: WebhookProvider;
}): Promise<ProcessOutcome> {
  const outcome = decideHotmartEvent(args.eventName, args.provider);

  await db
    .update(platformWebhookEvents)
    .set({
      processedAt: outcome.processed ? new Date() : null,
      error: outcome.processed ? null : outcome.reason,
    })
    .where(eq(platformWebhookEvents.id, args.eventId));

  return outcome;
}

export function decideHotmartEvent(
  eventName: string | null,
  provider: WebhookProvider,
): ProcessOutcome {
  if (!eventName) {
    return { processed: false, reason: "Entrega sem nome de evento — não dá para classificar." };
  }

  const mapped = HOTMART_EVENT_MAP[eventName];
  if (!mapped) {
    return {
      processed: false,
      reason: `Evento "${eventName}" não faz parte do mapa da Hotmart tratado aqui.`,
    };
  }

  if (!hasProductPlanMap(provider.config)) {
    return {
      processed: false,
      reason:
        `Mapa de produto→plano não configurado: sem ele não dá para saber a qual plano "${eventName}" ` +
        "se refere. O payload está guardado inteiro e pode ser reprocessado depois.",
    };
  }

  // Chegar aqui com o mapa preenchido ainda não é implementação: quando o
  // processamento for escrito, é este ponto que vira a transação (assinatura +
  // subscription_events juntos). Até lá, continua honesto dizer que não rodou.
  return {
    processed: false,
    reason: `Mapa de produto→plano existe, mas o processamento de "${eventName}" ainda não foi implementado.`,
  };
}

/** `config.productPlanMap`: { "<código do produto/oferta na Hotmart>": "<plans.slug>" }. */
function hasProductPlanMap(config: unknown): boolean {
  if (!config || typeof config !== "object") return false;
  const map = (config as Record<string, unknown>).productPlanMap;
  return Boolean(map && typeof map === "object" && Object.keys(map).length > 0);
}

// ─── Hubla: mapa de eventos → operação do domínio ────────────────────────────

/**
 * O que cada evento da Hubla significa aqui dentro.
 *
 * Nomes e formato (`type: "invoice.payment_succeeded"`, versão `2.0.0`)
 * conferidos contra a documentação oficial (Central de Ajuda da Hubla →
 * Webhooks → Eventos). O resto da estrutura — `subscriptionEventKind` nulo
 * onde depende do valor — segue a mesma régua de `HOTMART_EVENT_MAP` acima.
 */
export const HUBLA_EVENT_MAP: Record<
  string,
  { operation: HotmartOperation; subscriptionEventKind: string | null; description: string }
> = {
  "invoice.payment_succeeded": {
    operation: "start_or_convert_subscription",
    subscriptionEventKind: "created",
    description: "Fatura paga: começa a assinatura, ou converte o teste que estava aberto.",
  },
  "assinatura.criada": {
    operation: "start_or_convert_subscription",
    subscriptionEventKind: "created",
    description: "Assinatura criada na Hubla — chega antes da primeira fatura ser paga.",
  },
  "assinatura.ativada": {
    operation: "confirm_subscription",
    subscriptionEventKind: "renewed",
    description: "Assinatura ativada (renovação confirmada). Não muda o valor da assinatura.",
  },
  "assinatura.desativada": {
    operation: "cancel_subscription",
    subscriptionEventKind: "canceled",
    description: "Assinatura desativada na Hubla. MRR depois vai a zero.",
  },
  "assinatura.expirada": {
    operation: "cancel_subscription",
    subscriptionEventKind: "canceled",
    description: "Assinatura expirada (fim do período sem renovar). MRR depois vai a zero.",
  },
  "invoice.payment_failed": {
    operation: "cancel_subscription",
    subscriptionEventKind: "past_due",
    description: "Pagamento da fatura falhou. Marca a assinatura como inadimplente.",
  },
  "invoice.refunded": {
    operation: "cancel_subscription",
    subscriptionEventKind: "canceled",
    description: "Fatura reembolsada. Encerra o acesso e zera o MRR.",
  },
};

export function decideHublaEvent(eventName: string | null, provider: WebhookProvider): ProcessOutcome {
  if (!eventName) {
    return { processed: false, reason: "Entrega sem campo \"type\" — não dá para classificar." };
  }

  const mapped = HUBLA_EVENT_MAP[eventName];
  if (!mapped) {
    return {
      processed: false,
      reason: `Evento "${eventName}" não faz parte do mapa da Hubla tratado aqui.`,
    };
  }

  if (!hasProductPlanMap(provider.config)) {
    return {
      processed: false,
      reason:
        `Mapa de produto→plano não configurado: sem ele não dá para saber a qual plano "${eventName}" ` +
        "se refere. O payload está guardado inteiro e pode ser reprocessado depois.",
    };
  }

  return {
    processed: false,
    reason: `Mapa de produto→plano existe, mas o processamento de "${eventName}" ainda não foi implementado.`,
  };
}

export async function processHublaEvent(args: {
  eventId: number;
  eventName: string | null;
  provider: WebhookProvider;
}): Promise<ProcessOutcome> {
  const outcome = decideHublaEvent(args.eventName, args.provider);

  await db
    .update(platformWebhookEvents)
    .set({
      processedAt: outcome.processed ? new Date() : null,
      error: outcome.processed ? null : outcome.reason,
    })
    .where(eq(platformWebhookEvents.id, args.eventId));

  return outcome;
}
