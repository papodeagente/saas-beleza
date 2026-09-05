import { NextResponse } from "next/server";
import { db } from "@/db";
import { platformWebhookEvents } from "@/db/schema";
import {
  extractHublaEventName,
  extractHublaExternalId,
  extractWebhookToken,
  processHublaEvent,
  providerForWebhook,
  touchProviderLastEvent,
  webhookTokenMatches,
} from "@/server/services/hotmart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Entrada dos eventos de cobrança da Hubla.
 *
 * Mesmo desenho da rota da Hotmart (autenticar → gravar cru → responder 200
 * rápido) — ver os comentários de `src/app/api/webhooks/hotmart/route.ts` para
 * a razão de cada decisão. Conferido contra a documentação oficial da Hubla
 * (Central de Ajuda → Webhooks):
 *
 * - AUTENTICAÇÃO: token estático no header `x-hubla-token`, sem HMAC — mesmo
 *   desenho do hottok da Hotmart, então a comparação por hash já servia.
 * - DEDUPLICAÇÃO: `x-hubla-idempotency` identifica cada entrega; é o que vira
 *   `external_id`, não um campo do corpo.
 * - NOME DO EVENTO: campo `type` no corpo (ex.: "invoice.payment_succeeded"),
 *   não `event`/`status` como na Hotmart.
 *
 * O processamento da assinatura é PENDENTE de propósito, como na Hotmart:
 * falta o mapa de produto/oferta da Hubla → plano daqui, sem o qual inventar a
 * assinatura viraria receita fantasma no gráfico de MRR. O payload fica
 * guardado inteiro e reprocessável quando o mapa chegar.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const provider = await providerForWebhook("hubla");
  const token = extractWebhookToken(request, payload);

  if (!provider || !provider.enabled || !webhookTokenMatches(provider.webhookTokenHash, token)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const receivedAt = new Date();
  const eventName = extractHublaEventName(payload);
  const externalId = extractHublaExternalId(request, payload, rawBody);

  const [logged] = await db
    .insert(platformWebhookEvents)
    .values({
      providerId: provider.id,
      kind: "hubla",
      externalId,
      eventName,
      payload: payload as Record<string, unknown>,
      receivedAt,
    })
    .onConflictDoNothing({
      target: [platformWebhookEvents.kind, platformWebhookEvents.externalId],
    })
    .returning({ id: platformWebhookEvents.id });

  if (!logged) {
    // Reentrega do mesmo evento (mesma `x-hubla-idempotency`). Já está
    // guardado: confirmar é o suficiente.
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    await touchProviderLastEvent(provider.id, receivedAt);
  } catch (error) {
    console.error("hubla: falha ao marcar lastEventAt", error);
  }

  // Hoje isto só classifica e anota o motivo de não ter processado. Ver o
  // cabeçalho de src/server/services/hotmart.ts.
  try {
    await processHublaEvent({ eventId: logged.id, eventName, provider });
  } catch (error) {
    console.error("hubla: falha ao processar evento", error);
  }

  return NextResponse.json({ ok: true });
}
