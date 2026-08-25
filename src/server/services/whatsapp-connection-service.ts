import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { organizations, whatsappConnections } from "@/db/schema";
import type { TenantContext } from "@/server/auth";
import {
  connectInstance,
  disconnectInstance,
  getStatus,
  normalizeBaseUrl,
  type UazapiCredentials,
} from "@/server/whatsapp/uazapi-client";

/**
 * Conexão com o WhatsApp.
 *
 * O modelo aqui é deliberadamente manual: a instância da uazapi já existe e é
 * do cliente. Nós guardamos URL e token, validamos contra `/instance/status` e
 * mostramos a URL de webhook para ele colar no painel da uazapi. Nenhum token
 * de administração passa por este sistema, então não há como criar, cobrar ou
 * derrubar instância a partir daqui.
 */

export type ConnectionView = {
  id: number;
  name: string;
  baseUrl: string;
  tokenPreview: string;
  instanceName: string | null;
  phoneNumber: string | null;
  profileName: string | null;
  status: "disconnected" | "connecting" | "connected" | "error";
  statusDetail: string | null;
  pairingQrCode: string | null;
  pairingCode: string | null;
  pairingUpdatedAt: Date | null;
  webhookUrl: string;
  webhookSeenAt: Date | null;
  lastCheckedAt: Date | null;
  connectedAt: Date | null;
};

/** Só os últimos caracteres — o token nunca volta inteiro para o navegador. */
function maskToken(token: string): string {
  if (!token) return "";
  return token.length <= 8 ? "••••" : `••••${token.slice(-4)}`;
}

export function publicBaseUrl(): string {
  const raw = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";
  return raw.replace(/\/+$/, "");
}

export function webhookUrlFor(webhookToken: string): string {
  const base = publicBaseUrl();
  return `${base || ""}/api/webhooks/uazapi/${webhookToken}`;
}

function toView(row: typeof whatsappConnections.$inferSelect): ConnectionView {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    tokenPreview: maskToken(row.instanceToken),
    instanceName: row.instanceName,
    phoneNumber: row.phoneNumber,
    profileName: row.profileName,
    status: row.status,
    statusDetail: row.statusDetail,
    pairingQrCode: row.pairingQrCode,
    pairingCode: row.pairingCode,
    pairingUpdatedAt: row.pairingUpdatedAt,
    webhookUrl: webhookUrlFor(row.webhookToken),
    webhookSeenAt: row.webhookSeenAt,
    lastCheckedAt: row.lastCheckedAt,
    connectedAt: row.connectedAt,
  };
}

export async function getConnectionRow(organizationId: number) {
  const [row] = await db
    .select()
    .from(whatsappConnections)
    .where(and(eq(whatsappConnections.organizationId, organizationId), eq(whatsappConnections.active, true)))
    .orderBy(desc(whatsappConnections.id))
    .limit(1);
  return row ?? null;
}

export async function getConnection(ctx: TenantContext): Promise<ConnectionView | null> {
  const row = await getConnectionRow(ctx.organizationId);
  return row ? toView(row) : null;
}

export function credentialsOf(row: typeof whatsappConnections.$inferSelect): UazapiCredentials {
  return { baseUrl: row.baseUrl, token: row.instanceToken };
}

export type SaveConnectionInput = {
  name?: string;
  baseUrl: string;
  /** Ausente numa edição significa "manter o token atual". */
  instanceToken?: string;
};

/**
 * Nome da outra conta que já usa esta instância, ou nulo se estiver livre.
 *
 * Devolve o NOME e não um booleano porque quem cola o token precisa saber onde
 * o número está preso para poder soltá-lo — "já está em uso" sem dizer onde é
 * um beco sem saída para o suporte.
 */
async function donoDaInstancia(
  organizationId: number,
  token: string,
  instanceId: string | null,
): Promise<string | null> {
  const mesmaInstancia = instanceId
    ? or(eq(whatsappConnections.instanceToken, token), eq(whatsappConnections.instanceId, instanceId))
    : eq(whatsappConnections.instanceToken, token);
  const [outra] = await db
    .select({ nome: organizations.name })
    .from(whatsappConnections)
    .innerJoin(organizations, eq(organizations.id, whatsappConnections.organizationId))
    .where(
      and(
        mesmaInstancia,
        ne(whatsappConnections.organizationId, organizationId),
        // Conexão desligada não segura o número: é assim que uma clínica que
        // trocou de plataforma consegue levar o próprio aparelho embora.
        eq(whatsappConnections.active, true),
      ),
    )
    .limit(1);
  return outra?.nome ?? null;
}

export async function saveConnection(ctx: TenantContext, input: SaveConnectionInput): Promise<ConnectionView> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  if (!baseUrl) throw new Error("Informe a URL do servidor uazapi.");

  const existing = await getConnectionRow(ctx.organizationId);
  const token = (input.instanceToken || "").trim() || existing?.instanceToken || "";
  if (!token) throw new Error("Informe o token da instância.");

  // Valida antes de gravar: token errado é o erro mais comum, e descobrir isso
  // só quando a primeira mensagem não chega custa caro.
  const status = await getStatus({ baseUrl, token });

  // Um número de WhatsApp atende UMA conta.
  //
  // Sem esta trava, duas contas apontando para a mesma instância recebem o
  // mesmo webhook e gravam a mesma conversa duas vezes — cada atendente
  // enxergando as clientes da outra. Está acontecendo hoje entre duas contas
  // desta base (mesmo token, mesmo número, 3.300 mensagens espelhadas), e o
  // banco não tinha como impedir. A comparação é pela instância, não pelo
  // token: emitir um token novo para o mesmo aparelho não o torna outro.
  const jaEmUso = await donoDaInstancia(ctx.organizationId, token, status.instanceId);
  if (jaEmUso) {
    throw new Error(
      `Este WhatsApp já está conectado na conta ${jaEmUso}. Um número atende uma conta por vez: desconecte-o de lá antes de conectar aqui.`,
    );
  }

  const values = {
    organizationId: ctx.organizationId,
    name: input.name?.trim() || existing?.name || "WhatsApp",
    baseUrl,
    instanceToken: token,
    instanceId: status.instanceId,
    instanceName: status.instanceName,
    phoneNumber: status.phoneNumber,
    profileName: status.profileName,
    status: status.connected ? ("connected" as const) : ("disconnected" as const),
    statusDetail: status.status,
    lastCheckedAt: new Date(),
    connectedAt: status.connected ? (existing?.connectedAt ?? new Date()) : existing?.connectedAt,
    updatedAt: new Date(),
  };

  if (existing) {
    const [row] = await db
      .update(whatsappConnections)
      .set(values)
      .where(and(eq(whatsappConnections.id, existing.id), eq(whatsappConnections.organizationId, ctx.organizationId)))
      .returning();
    return toView(row);
  }

  const [row] = await db
    .insert(whatsappConnections)
    .values({ ...values, webhookToken: randomBytes(24).toString("hex"), active: true })
    .returning();
  return toView(row);
}

/** Reconsulta o status na uazapi e grava o resultado. */
export async function refreshConnectionStatus(ctx: TenantContext): Promise<ConnectionView> {
  const existing = await getConnectionRow(ctx.organizationId);
  if (!existing) throw new Error("Nenhuma conexão configurada.");

  try {
    const status = await getStatus(credentialsOf(existing));
    const [row] = await db
      .update(whatsappConnections)
      .set({
        status: status.connected ? "connected" : "disconnected",
        statusDetail: status.status,
        instanceId: status.instanceId ?? existing.instanceId,
        instanceName: status.instanceName ?? existing.instanceName,
        phoneNumber: status.phoneNumber ?? existing.phoneNumber,
        profileName: status.profileName ?? existing.profileName,
        connectedAt: status.connected ? (existing.connectedAt ?? new Date()) : existing.connectedAt,
        // Conectou: o QR na tela virou lixo visual e precisa sumir.
        ...(status.connected ? { pairingQrCode: null, pairingCode: null, pairingUpdatedAt: null } : {}),
        lastCheckedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(whatsappConnections.id, existing.id))
      .returning();
    return toView(row);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "erro desconhecido";
    const [row] = await db
      .update(whatsappConnections)
      .set({ status: "error", statusDetail: detail.slice(0, 300), lastCheckedAt: new Date(), updatedAt: new Date() })
      .where(eq(whatsappConnections.id, existing.id))
      .returning();
    return toView(row);
  }
}

/**
 * Inicia o pareamento do aparelho.
 *
 * Sem número, devolve o QR para escanear; com número, um código de oito dígitos
 * para digitar no celular. O resultado é gravado porque a uazapi também emite
 * QR novo por webhook quando o atual expira, e as duas origens precisam
 * alimentar a mesma tela.
 */
export async function startPairing(
  ctx: TenantContext,
  opts: { phone?: string } = {},
): Promise<ConnectionView> {
  const existing = await getConnectionRow(ctx.organizationId);
  if (!existing) throw new Error("Configure a URL e o token da instância antes de parear.");

  const result = await connectInstance(credentialsOf(existing), opts);

  const [row] = await db
    .update(whatsappConnections)
    .set({
      status: result.connected ? "connected" : "connecting",
      statusDetail: result.connected ? result.status : "aguardando leitura do QR",
      pairingQrCode: result.connected ? null : result.qrCode,
      pairingCode: result.connected ? null : result.pairCode,
      pairingUpdatedAt: result.connected ? null : new Date(),
      connectedAt: result.connected ? (existing.connectedAt ?? new Date()) : existing.connectedAt,
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(whatsappConnections.id, existing.id))
    .returning();
  return toView(row);
}

/**
 * Desconecta o aparelho na uazapi.
 *
 * É logout: para voltar a receber mensagem é preciso parear de novo. Fica
 * separado de `disconnectConnection`, que apenas remove a conexão daqui sem
 * tocar na instância.
 */
export async function disconnectDevice(ctx: TenantContext): Promise<ConnectionView> {
  const existing = await getConnectionRow(ctx.organizationId);
  if (!existing) throw new Error("Nenhuma conexão configurada.");

  await disconnectInstance(credentialsOf(existing));

  const [row] = await db
    .update(whatsappConnections)
    .set({
      status: "disconnected",
      statusDetail: "desconectado por aqui",
      pairingQrCode: null,
      pairingCode: null,
      pairingUpdatedAt: null,
      connectedAt: null,
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(whatsappConnections.id, existing.id))
    .returning();
  return toView(row);
}

/** Troca o segredo da URL do webhook. A URL antiga para de ser aceita na hora. */
export async function rotateWebhookToken(ctx: TenantContext): Promise<ConnectionView> {
  const existing = await getConnectionRow(ctx.organizationId);
  if (!existing) throw new Error("Nenhuma conexão configurada.");
  const [row] = await db
    .update(whatsappConnections)
    .set({ webhookToken: randomBytes(24).toString("hex"), webhookSeenAt: null, updatedAt: new Date() })
    .where(eq(whatsappConnections.id, existing.id))
    .returning();
  return toView(row);
}

export async function disconnectConnection(ctx: TenantContext): Promise<void> {
  const existing = await getConnectionRow(ctx.organizationId);
  if (!existing) return;
  // Desativa o registro local; a instância na uazapi continua intacta, porque
  // ela não é nossa para desligar.
  await db
    .update(whatsappConnections)
    .set({ active: false, status: "disconnected", updatedAt: new Date() })
    .where(eq(whatsappConnections.id, existing.id));
}

/** Conexão a partir do segredo da URL do webhook. Não exige sessão. */
export async function connectionByWebhookToken(token: string) {
  if (!token) return null;
  const [row] = await db
    .select()
    .from(whatsappConnections)
    .where(eq(whatsappConnections.webhookToken, token))
    .limit(1);
  return row ?? null;
}
