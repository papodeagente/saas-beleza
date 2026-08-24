import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { whatsappConnections, whatsappWebhookEvents } from "@/db/schema";
import { connectionByWebhookToken } from "@/server/services/whatsapp-connection-service";
import { publishInboxEvent } from "@/server/services/inbox-events";
import {
  applyReaction,
  applyStatusUpdate,
  ingestMessage,
  markMessageDeleted,
  transcribeAudio,
} from "@/server/services/whatsapp-message-service";
import { normalizeUazapiWebhookBatch } from "@/server/whatsapp/normalizer";

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

  const events = normalizeUazapiWebhookBatch(payload);
  const event = events[0];
  const payloadObject = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
  const rawEventName = String(
    payloadObject.EventType ?? (typeof payloadObject.event === "string" ? payloadObject.event : payloadObject.type) ?? "",
  ).toLowerCase();
  const historical = rawEventName === "history";
  const dedupeKey =
    events.length !== 1
      ? null
      : event.kind === "message"
      ? `msg:${event.message.externalId}`
      : event.kind === "reaction"
        ? `react:${event.targetExternalId}:${event.emoji}:${event.fromMe ? "me" : "them"}`
        : event.kind === "status"
        ? `status:${event.externalIds.join(",")}:${event.status}`
        : null;

  const [logged] = await db
    .insert(whatsappWebhookEvents)
    .values({
      connectionId: connection.id,
      organizationId: connection.organizationId,
      eventType: events.length === 1 ? event.kind : historical ? "history" : "message_batch",
      dedupeKey,
      payload: payload as Record<string, unknown>,
    })
    .onConflictDoNothing({ target: [whatsappWebhookEvents.connectionId, whatsappWebhookEvents.dedupeKey] })
    .returning({ id: whatsappWebhookEvents.id });

  let logId = logged?.id ?? null;
  // Uma falha anterior não pode transformar a reentrega em falso sucesso.
  // Só descartamos o evento quando ele realmente terminou sem erro.
  if (!logged && dedupeKey) {
    const [existing] = await db
      .select({ id: whatsappWebhookEvents.id, processedAt: whatsappWebhookEvents.processedAt, error: whatsappWebhookEvents.error })
      .from(whatsappWebhookEvents)
      .where(and(eq(whatsappWebhookEvents.connectionId, connection.id), eq(whatsappWebhookEvents.dedupeKey, dedupeKey)))
      .limit(1);
    if (existing?.processedAt && !existing.error) return NextResponse.json({ ok: true, duplicate: true });
    logId = existing?.id ?? null;
  }

  // Sinal de vida da conexão: prova que o webhook está mesmo apontado para cá.
  void db
    .update(whatsappConnections)
    .set({ webhookSeenAt: new Date() })
    .where(eq(whatsappConnections.id, connection.id))
    .catch(() => {});

  try {
    for (const current of events) {
      if (current.kind === "message") {
        const result = await ingestMessage(connection, current.message, { historical });
        if (result.isNew || result.isUpdated) {
          await publishInboxEvent(connection.organizationId, {
            type: "message",
            conversationId: result.conversationId,
          });
        }
        if (result.isNew && result.isInbound && !historical) {
          if (current.message.kind === "audio" && result.messageId && process.env.OPENAI_API_KEY) {
            await transcribeAudio(connection.organizationId, result.conversationId, result.messageId).catch((error) => {
              console.warn("[uazapi webhook] áudio recebido sem transcrição:", error instanceof Error ? error.message : error);
            });
          }
          // Histórico é só reconciliação e nunca pode acordar a IA para
          // responder mensagens antigas. Mensagens novas seguem para a fila.
          const { enqueueAgentTurn } = await import("@/server/queues/agent-turn-queue");
          await enqueueAgentTurn({
            organizationId: connection.organizationId,
            conversationId: result.conversationId,
            customerId: result.customerId,
          });
        }
      } else if (current.kind === "status") {
        for (const externalId of current.externalIds) {
          await applyStatusUpdate(connection, externalId, current.status);
        }
        await publishInboxEvent(connection.organizationId, { type: "status" });
      } else if (current.kind === "reaction") {
        await applyReaction(connection, current.targetExternalId, current.emoji, current.fromMe);
        await publishInboxEvent(connection.organizationId, { type: "reaction" });
      } else if (current.kind === "deleted") {
        await markMessageDeleted(connection, current.externalId);
        await publishInboxEvent(connection.organizationId, { type: "deleted" });
      } else if (current.kind === "qrcode") {
        await db
          .update(whatsappConnections)
          .set({
            status: "connecting",
            statusDetail: "aguardando leitura do QR",
            pairingQrCode: current.qrCode,
            pairingCode: current.pairCode,
            pairingUpdatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(whatsappConnections.id, connection.id));
      } else if (current.kind === "connection") {
        await db
          .update(whatsappConnections)
          .set({
            status: current.connected ? "connected" : "disconnected",
            statusDetail: current.status,
            connectedAt: current.connected ? (connection.connectedAt ?? new Date()) : connection.connectedAt,
            ...(current.connected ? { pairingQrCode: null, pairingCode: null, pairingUpdatedAt: null } : {}),
            updatedAt: new Date(),
          })
          .where(eq(whatsappConnections.id, connection.id));
      }
    }

    if (logId) {
      await db
        .update(whatsappWebhookEvents)
        .set({ processedAt: new Date(), error: null })
        .where(eq(whatsappWebhookEvents.id, logId));
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[uazapi webhook] falha ao processar:", detail);
    if (logId) {
      await db
        .update(whatsappWebhookEvents)
        .set({ error: detail.slice(0, 1000), processedAt: null })
        .where(eq(whatsappWebhookEvents.id, logId))
        .catch(() => {});
    }
    return NextResponse.json({ ok: false, processed: false }, { status: 503 });
  }
}

/** A uazapi valida a URL com um GET antes de salvar. */
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const connection = await connectionByWebhookToken(token);
  if (!connection) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json({ ok: true, service: "lumina-uazapi-webhook" });
}
