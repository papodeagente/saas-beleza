import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { whatsappConnections, whatsappWebhookEvents } from "@/db/schema";
import { connectionByWebhookToken } from "@/server/services/whatsapp-connection-service";
import { applyStatusUpdate, ingestMessage } from "@/server/services/whatsapp-message-service";
import { normalizeUazapiWebhook } from "@/server/whatsapp/normalizer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Entrada de tudo que vem do WhatsApp.
 *
 * A uazapi não assina o payload, então o segredo está na própria URL: cada
 * organização recebe um caminho único, que ela cola no painel da uazapi e pode
 * rotacionar quando quiser.
 *
 * Responde 200 mesmo quando falha ao processar. A uazapi reentrega em erro, e
 * uma falha nossa (um campo inesperado, o banco fora do ar) viraria uma
 * tempestade de reentregas do mesmo evento. O payload cru fica gravado em
 * `whatsapp_webhook_events` com o erro, que é o que permite reprocessar depois
 * sabendo exatamente o que chegou.
 */
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const connection = await connectionByWebhookToken(token);
  if (!connection) {
    return NextResponse.json({ ok: false, error: "webhook desconhecido" }, { status: 404 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "payload inválido" }, { status: 400 });
  }

  const event = normalizeUazapiWebhook(payload);
  const dedupeKey =
    event.kind === "message"
      ? `msg:${event.message.externalId}`
      : event.kind === "status"
        ? `status:${event.externalId}:${event.status}`
        : null;

  const [logged] = await db
    .insert(whatsappWebhookEvents)
    .values({
      connectionId: connection.id,
      organizationId: connection.organizationId,
      eventType: event.kind,
      dedupeKey,
      payload: payload as Record<string, unknown>,
    })
    .onConflictDoNothing({ target: [whatsappWebhookEvents.connectionId, whatsappWebhookEvents.dedupeKey] })
    .returning({ id: whatsappWebhookEvents.id });

  // Sem linha nova: já processamos este evento antes.
  if (!logged && dedupeKey) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  // Sinal de vida da conexão: prova que o webhook está mesmo apontado para cá.
  void db
    .update(whatsappConnections)
    .set({ webhookSeenAt: new Date() })
    .where(eq(whatsappConnections.id, connection.id))
    .catch(() => {});

  try {
    if (event.kind === "message") {
      const result = await ingestMessage(connection, event.message);
      if (result.isNew && result.isInbound) {
        // Nunca bloqueia o webhook: o turno do agente roda em background.
        const { enqueueAgentTurn } = await import("@/server/queues/agent-turn-queue");
        await enqueueAgentTurn({
          organizationId: connection.organizationId,
          conversationId: result.conversationId,
          customerId: result.customerId,
        });
      }
    } else if (event.kind === "status") {
      await applyStatusUpdate(connection, event.externalId, event.status);
    } else if (event.kind === "qrcode") {
      await db
        .update(whatsappConnections)
        .set({
          status: "connecting",
          statusDetail: "aguardando leitura do QR",
          pairingQrCode: event.qrCode,
          pairingCode: event.pairCode,
          pairingUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(whatsappConnections.id, connection.id));
    } else if (event.kind === "connection") {
      await db
        .update(whatsappConnections)
        .set({
          status: event.connected ? "connected" : "disconnected",
          statusDetail: event.status,
          connectedAt: event.connected ? (connection.connectedAt ?? new Date()) : connection.connectedAt,
          // Pareou: o código não serve mais para nada e não deve continuar
          // visível na tela.
          ...(event.connected
            ? { pairingQrCode: null, pairingCode: null, pairingUpdatedAt: null }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(whatsappConnections.id, connection.id));
    }

    if (logged) {
      await db
        .update(whatsappWebhookEvents)
        .set({ processedAt: new Date() })
        .where(eq(whatsappWebhookEvents.id, logged.id));
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[uazapi webhook] falha ao processar:", detail);
    if (logged) {
      await db
        .update(whatsappWebhookEvents)
        .set({ error: detail.slice(0, 1000), processedAt: new Date() })
        .where(eq(whatsappWebhookEvents.id, logged.id))
        .catch(() => {});
    }
    return NextResponse.json({ ok: true, processed: false });
  }
}

/** A uazapi valida a URL com um GET antes de salvar. */
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const connection = await connectionByWebhookToken(token);
  if (!connection) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json({ ok: true, service: "lumina-uazapi-webhook" });
}
