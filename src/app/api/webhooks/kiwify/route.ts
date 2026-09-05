import { NextResponse } from "next/server";
import { db } from "@/db";
import { platformWebhookEvents } from "@/db/schema";
import {
  extractEventName,
  extractExternalId,
  extractWebhookToken,
  providerForWebhook,
  touchProviderLastEvent,
  webhookTokenMatches,
} from "@/server/services/hotmart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Entrada dos eventos de cobrança da Kiwify.
 *
 * Mesmo desenho da rota da Hotmart (autenticar → gravar cru → responder 200
 * rápido) — ver os comentários de `src/app/api/webhooks/hotmart/route.ts` para
 * a razão de cada decisão. A Kiwify costuma autenticar por assinatura na query
 * string (`?signature=`) em vez de header fixo; `extractWebhookToken` já olha
 * lá, mas isso ainda não foi conferido contra uma conta de verdade — confirme
 * a convenção exata no painel da Kiwify antes de ligar um provedor real.
 *
 * O processamento da assinatura é PENDENTE de propósito, como na Hotmart:
 * falta o mapa de produto/oferta da Kiwify → plano daqui, sem o qual inventar
 * a assinatura viraria receita fantasma no gráfico de MRR. O payload fica
 * guardado inteiro, marcado como não processado, e reprocessável quando o
 * mapa e a operação de domínio existirem.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const provider = await providerForWebhook("kiwify");
  const token = extractWebhookToken(request, payload);

  if (!provider || !provider.enabled || !webhookTokenMatches(provider.webhookTokenHash, token)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const receivedAt = new Date();
  const eventName = extractEventName(payload);
  const externalId = extractExternalId(payload, rawBody);
  const error = eventName
    ? `Recebido e autenticado, mas o processamento de eventos da Kiwify ainda não foi implementado (evento "${eventName}").`
    : "Recebido e autenticado, mas sem nome de evento identificável — não dá para classificar.";

  const [logged] = await db
    .insert(platformWebhookEvents)
    .values({
      providerId: provider.id,
      kind: "kiwify",
      externalId,
      eventName,
      payload: payload as Record<string, unknown>,
      receivedAt,
      error,
    })
    .onConflictDoNothing({
      target: [platformWebhookEvents.kind, platformWebhookEvents.externalId],
    })
    .returning({ id: platformWebhookEvents.id });

  if (!logged) {
    // Reentrega do mesmo evento. Já está guardado: confirmar é o suficiente.
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    await touchProviderLastEvent(provider.id, receivedAt);
  } catch (err) {
    console.error("kiwify: falha ao marcar lastEventAt", err);
  }

  return NextResponse.json({ ok: true });
}
