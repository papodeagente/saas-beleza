import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { whatsappConnections } from "@/db/schema";
import type { TenantContext } from "@/server/auth";
import { getStatus, normalizeBaseUrl, type UazapiCredentials } from "@/server/whatsapp/uazapi-client";

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

export async function saveConnection(ctx: TenantContext, input: SaveConnectionInput): Promise<ConnectionView> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  if (!baseUrl) throw new Error("Informe a URL do servidor uazapi.");

  const existing = await getConnectionRow(ctx.organizationId);
  const token = (input.instanceToken || "").trim() || existing?.instanceToken || "";
  if (!token) throw new Error("Informe o token da instância.");

  // Valida antes de gravar: token errado é o erro mais comum, e descobrir isso
  // só quando a primeira mensagem não chega custa caro.
  const status = await getStatus({ baseUrl, token });

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
