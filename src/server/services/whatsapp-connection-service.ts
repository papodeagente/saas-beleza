import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { whatsappConnections } from "@/db/schema";
import type { TenantContext } from "@/server/auth";
import {
  apagarInstancia,
  configurarWebhook,
  connectInstance,
  criarInstancia,
  disconnectInstance,
  ehDaPlataforma,
  getStatus,
  servidorDaPlataforma,
  type UazapiCredentials,
} from "@/server/whatsapp/uazapi-client";

/**
 * Conexão com o WhatsApp.
 *
 * Há um caminho só: o sistema cria a instância da conta no servidor da
 * plataforma (`UAZAPI_SERVER_URL` + `UAZAPI_ADMIN_TOKEN`), aponta o webhook e
 * mostra o QR. Uma instância por conta; remover a conexão apaga a instância e
 * devolve a cota.
 *
 * O cadastro manual — colar URL e token de uma instância do cliente — foi
 * removido. Ele existia de quando a instância era dele, e pedia da manicure
 * dois dados que ela não tem como responder. Conexão antiga de instância
 * própria continua no banco e continua RECEBENDO mensagem enquanto estiver
 * ativa; o que não existe mais é criar ou editar uma dessas por aqui, e
 * conectar pelo servidor da plataforma aposenta a antiga.
 *
 * O token de administração nunca chega a este módulo: quem fala com ele é o
 * cliente da uazapi, e o que volta é só o token da instância daquela conta.
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
  /**
   * A instância é nossa (criada pela plataforma) ou do cliente?
   *
   * A tela usa isto para decidir o que mostrar: quem está no servidor da
   * plataforma não precisa ver URL, token nem endereço de webhook — são dados
   * internos que só teriam como efeito assustar.
   */
  gerenciadaPelaPlataforma: boolean;
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
    gerenciadaPelaPlataforma: ehDaPlataforma(row.baseUrl),
  };
}

/** Existe servidor próprio para criar instância? */
export function provisionamentoDisponivel(): boolean {
  return servidorDaPlataforma() !== null;
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

/**
 * Cria a instância da conta no servidor da plataforma e já devolve o QR.
 *
 * É o caminho inteiro num clique: instância criada, webhook apontado para cá e
 * pareamento iniciado. A cliente não vê nem precisa saber de nenhuma das três
 * coisas — ela abre a tela, escaneia e está conectada.
 *
 * **Uma conta, uma instância.** Se já existe conexão ativa, esta função não
 * cria outra: ela renova o QR da que existe. Sem essa guarda, cada clique
 * criaria uma instância órfã no servidor, e a conta acumularia aparelhos que
 * ninguém desligaria depois.
 */
export async function provisionarConexao(ctx: TenantContext): Promise<ConnectionView> {
  const existente = await getConnectionRow(ctx.organizationId);
  if (existente && ehDaPlataforma(existente.baseUrl)) return startPairing(ctx);

  if (existente) {
    /**
     * Conexão do tempo em que a instância era do cliente.
     *
     * Ela sai do sistema, mas NÃO é desligada do outro lado: o aparelho é
     * dele, e derrubá-lo seria interromper o atendimento de alguém para
     * arrumar o nosso cadastro. O que acontece aqui é uma troca — a conta
     * passa a usar a instância da plataforma, e por isso o número precisa ser
     * pareado de novo.
     */
    await db
      .update(whatsappConnections)
      .set({ active: false, status: "disconnected", updatedAt: new Date() })
      .where(eq(whatsappConnections.id, existente.id));
  }

  const plataforma = servidorDaPlataforma();
  if (!plataforma) {
    throw new Error("O servidor de WhatsApp da plataforma não está configurado.");
  }
  // Sem endereço público não há webhook possível, e uma instância que ninguém
  // escuta é pior que nenhuma: a cliente conecta, manda mensagem e o silêncio
  // parece defeito do produto.
  if (!publicBaseUrl()) {
    throw new Error("Falta configurar o endereço público do sistema (APP_URL) antes de conectar o WhatsApp.");
  }

  // O nome carrega conta e id: no painel do servidor, saber de quem é cada
  // aparelho é o que permite responder a um chamado de suporte.
  const instancia = await criarInstancia(`${ctx.organizationSlug}-${ctx.organizationId}`);
  const webhookToken = randomBytes(24).toString("hex");

  const [row] = await db
    .insert(whatsappConnections)
    .values({
      organizationId: ctx.organizationId,
      name: "WhatsApp",
      baseUrl: instancia.baseUrl,
      instanceToken: instancia.token,
      instanceId: instancia.instanceId,
      webhookToken,
      status: "disconnected",
      statusDetail: "instância criada",
      active: true,
    })
    .returning();

  // O webhook vai ANTES do QR: se a cliente escanear rápido e a primeira
  // mensagem chegar em seguida, o caminho já está aberto.
  await configurarWebhook(credentialsOf(row), webhookUrlFor(webhookToken));

  return startPairing(ctx);
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

  // Reaponta o webhook a cada pareamento da instância nossa. É barato e cobre
  // o caso que já custou caro antes: instância reconectada com o webhook
  // apagado do outro lado, aparelho no ar e nenhuma mensagem chegando.
  if (ehDaPlataforma(existing.baseUrl) && publicBaseUrl()) {
    try {
      await configurarWebhook(credentialsOf(existing), webhookUrlFor(existing.webhookToken));
    } catch (error) {
      // Não impede o QR: sem webhook a conexão ainda se estabelece, e insistir
      // aqui tiraria da cliente a única ação que ela veio fazer.
      console.warn("[whatsapp] não foi possível reapontar o webhook:", error);
    }
  }

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

export async function disconnectConnection(ctx: TenantContext): Promise<void> {
  const existing = await getConnectionRow(ctx.organizationId);
  if (!existing) return;

  // Instância nossa é apagada de verdade: é o que devolve a cota da conta (uma
  // por conta) e evita um parque de aparelhos mortos no servidor. A do cliente
  // fica intacta — ela não é nossa para desligar.
  if (ehDaPlataforma(existing.baseUrl)) {
    try {
      await apagarInstancia(credentialsOf(existing));
    } catch (error) {
      // O registro local sai de qualquer forma: deixar a conta presa a uma
      // conexão que ela mandou remover é pior do que uma instância órfã, que o
      // painel do servidor mostra e alguém limpa.
      console.warn("[whatsapp] não foi possível apagar a instância:", error);
    }
  }

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
