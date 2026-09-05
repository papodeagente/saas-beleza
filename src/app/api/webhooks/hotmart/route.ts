import { NextResponse } from "next/server";
import { db } from "@/db";
import { platformWebhookEvents } from "@/db/schema";
import {
  extractEventName,
  extractExternalId,
  extractHottok,
  hottokMatches,
  processHotmartEvent,
  providerForWebhook,
  touchProviderLastEvent,
} from "@/server/services/hotmart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Entrada dos eventos de cobrança da Hotmart.
 *
 * Três decisões que valem ser ditas:
 *
 * 1. AUTENTICAÇÃO. A Hotmart não assina o corpo: ela repete um token fixo (o
 *    "hottok") em toda entrega, no header `x-hotmart-hottok` ou no corpo. Aqui
 *    ele é comparado por HASH, em tempo constante, com o que está guardado no
 *    provedor. Recusa é sempre um 401 seco, sem dizer se o provedor existe, se
 *    está desligado ou se o token é que estava errado — a resposta de erro é a
 *    mesma para os três, porque cada palavra a mais ajudaria quem está tentando
 *    adivinhar.
 *
 * 2. GRAVAR ANTES DE PROCESSAR. O payload cru entra em `platform_webhook_events`
 *    antes de qualquer interpretação. Um evento que não sabemos processar hoje
 *    continua guardado inteiro e reprocessável amanhã; se a gravação viesse
 *    depois do processamento, todo evento que quebrasse o processamento também
 *    se perderia.
 *
 * 3. 200 RÁPIDO. A Hotmart reentrega o que não recebe 200 em poucos segundos.
 *    Reentrega esbarra no índice único (kind, external_id) e volta 200 na hora,
 *    sem processar de novo. Falha nossa depois da gravação também responde 200:
 *    o erro fica anotado na linha do evento, não vira uma tempestade de retentativas.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const provider = await providerForWebhook("hotmart");
  const hottok = extractHottok(request.headers.get("x-hotmart-hottok"), payload);

  // Desligado conta como não configurado: o botão "ligado" é o interruptor real
  // desta porta, não um enfeite da tela.
  if (!provider || !provider.enabled || !hottokMatches(provider.webhookTokenHash, hottok)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const receivedAt = new Date();
  const eventName = extractEventName(payload);
  const externalId = extractExternalId(payload, rawBody);

  const [logged] = await db
    .insert(platformWebhookEvents)
    .values({
      providerId: provider.id,
      kind: "hotmart",
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
    // Reentrega do mesmo evento. Já está guardado: confirmar é o suficiente.
    return NextResponse.json({ ok: true, duplicate: true });
  }

  // Sinal de vida do provedor. Se falhar, o evento já está salvo — não é motivo
  // para devolver erro e provocar reentrega.
  try {
    await touchProviderLastEvent(provider.id, receivedAt);
  } catch (error) {
    console.error("hotmart: falha ao marcar lastEventAt", error);
  }

  // Hoje isto só classifica e anota o motivo de não ter processado. Ver o
  // cabeçalho de src/server/services/hotmart.ts.
  try {
    await processHotmartEvent({ eventId: logged.id, eventName, provider });
  } catch (error) {
    console.error("hotmart: falha ao processar evento", error);
  }

  return NextResponse.json({ ok: true });
}
