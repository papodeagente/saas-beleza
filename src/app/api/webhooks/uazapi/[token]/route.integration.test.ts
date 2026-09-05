import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import * as s from "@/db/schema";
import { POST } from "./route";

/**
 * A corrida que perdia confirmação de entrega.
 *
 * Medido em produção em 24/08/2026: 50 de 54 confirmações "Delivered" foram
 * processadas contra linha inexistente — a uazapi entrega o `messages_update`
 * antes do `messages` que cria a mensagem. O handler devolvia em silêncio e a
 * deduplicação marcava o evento como concluído com sucesso: dado perdido para
 * sempre, mensagem eternamente "enviada" na tela.
 *
 * O contrato agora é: 503 pede reentrega, e o teto de tentativas impede que um
 * evento que nunca vai casar seja reentregue para sempre.
 */

const SUFFIX = `vitest-webhook-${randomBytes(4).toString("hex")}`;
let organizationId: number;
let connectionId: number;
let webhookToken: string;

function requisicao(payload: unknown) {
  return POST(
    new Request("https://exemplo.test/api/webhooks/uazapi/x", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ token: webhookToken }) },
  );
}

function confirmacao(externalId: string) {
  return {
    EventType: "messages_update",
    instanceName: SUFFIX,
    event: { Chat: "5511977776666@s.whatsapp.net", Type: "Delivered", MessageIDs: [externalId] },
  };
}

function downloadConcluido(externalIds: string[]) {
  return {
    EventType: "messages_update",
    instanceName: SUFFIX,
    event: {
      Chat: "5511977776666@s.whatsapp.net",
      Type: "FileDownloaded",
      chatid: "5511977776666@s.whatsapp.net",
      MessageIDs: externalIds,
      FileURL: `https://enturos.uazapi.com/files/${externalIds[0]}.jpg`,
      MimeType: "image/jpeg",
    },
  };
}

/** Uma mensagem de imagem já gravada, do jeito que o webhook a teria criado. */
async function mensagemDeImagem(externalId: string, status: "sent" | "read" = "sent") {
  const [conversation] = await db
    .insert(s.conversations)
    .values({ organizationId, connectionId, remoteJid: `${externalId}@s.whatsapp.net`, channel: "whatsapp" })
    .returning();
  await db.insert(s.messages).values({
    organizationId,
    conversationId: conversation.id,
    direction: "inbound",
    sender: "customer",
    body: "[imagem]",
    messageType: "image",
    status,
    externalId,
    sentAt: new Date(),
  });
  return conversation.id;
}

beforeAll(async () => {
  const [org] = await db
    .insert(s.organizations)
    .values({ name: "Webhook", slug: SUFFIX, publicId: SUFFIX, timezone: "America/Sao_Paulo" })
    .returning();
  organizationId = org.id;
  webhookToken = SUFFIX;
  const [conn] = await db
    .insert(s.whatsappConnections)
    .values({ organizationId, baseUrl: "https://invalido.test", instanceToken: "x", webhookToken })
    .returning();
  connectionId = conn.id;
});

afterAll(async () => {
  await db.delete(s.whatsappWebhookEvents).where(eq(s.whatsappWebhookEvents.organizationId, organizationId));
  const convs = await db
    .select({ id: s.conversations.id })
    .from(s.conversations)
    .where(eq(s.conversations.organizationId, organizationId));
  for (const conv of convs) await db.delete(s.messages).where(eq(s.messages.conversationId, conv.id));
  await db.delete(s.conversations).where(eq(s.conversations.organizationId, organizationId));
  await db.delete(s.customers).where(eq(s.customers.organizationId, organizationId));
  await db.delete(s.whatsappConnections).where(eq(s.whatsappConnections.id, connectionId));
  await db.delete(s.organizations).where(eq(s.organizations.id, organizationId));
  await pool.end();
});

async function eventoGravado(dedupeKey: string) {
  const [row] = await db
    .select()
    .from(s.whatsappWebhookEvents)
    .where(
      and(eq(s.whatsappWebhookEvents.connectionId, connectionId), eq(s.whatsappWebhookEvents.dedupeKey, dedupeKey)),
    )
    .orderBy(desc(s.whatsappWebhookEvents.id))
    .limit(1);
  return row;
}

describe("webhook da uazapi: confirmação que chega antes da mensagem", () => {
  it("pede reentrega em vez de dar o evento por processado", async () => {
    const externalId = `CEDO_${randomBytes(4).toString("hex")}`;
    const resposta = await requisicao(confirmacao(externalId));

    expect(resposta.status).toBe(503);
    const evento = await eventoGravado(`status:${externalId}:delivered`);
    expect(evento.processedAt).toBeNull();
    expect(evento.error).toContain(externalId);
    expect(evento.attempts).toBe(1);
  });

  it("aplica a confirmação na reentrega, quando a mensagem já existe", async () => {
    const externalId = `REENTREGA_${randomBytes(4).toString("hex")}`;
    const primeira = await requisicao(confirmacao(externalId));
    expect(primeira.status).toBe(503);

    // Entre as duas tentativas chega o evento `messages` que cria a linha.
    const [conversation] = await db
      .insert(s.conversations)
      .values({ organizationId, connectionId, remoteJid: `${externalId}@s.whatsapp.net`, channel: "whatsapp" })
      .returning();
    await db.insert(s.messages).values({
      organizationId,
      conversationId: conversation.id,
      direction: "outbound",
      sender: "user",
      body: "oi",
      status: "sent",
      externalId,
      sentAt: new Date(),
    });

    const segunda = await requisicao(confirmacao(externalId));
    expect(segunda.status).toBe(200);

    const [mensagem] = await db
      .select()
      .from(s.messages)
      .where(and(eq(s.messages.organizationId, organizationId), eq(s.messages.externalId, externalId)));
    expect(mensagem.status).toBe("delivered");

    const evento = await eventoGravado(`status:${externalId}:delivered`);
    expect(evento.processedAt).not.toBeNull();
    expect(evento.error).toBeNull();
  });

  it("desiste depois do teto de tentativas, para não reentregar para sempre", async () => {
    const externalId = `VENENOSO_${randomBytes(4).toString("hex")}`;
    for (let i = 0; i < 10; i++) {
      const r = await requisicao(confirmacao(externalId));
      expect(r.status).toBe(503);
    }

    const ultima = await requisicao(confirmacao(externalId));
    expect(ultima.status).toBe(200);
    expect(await ultima.json()).toMatchObject({ desistiu: true });

    const evento = await eventoGravado(`status:${externalId}:delivered`);
    expect(evento.attempts).toBe(10);
    // Encerrado com o motivo preservado: some da fila, não some do histórico.
    expect(evento.processedAt).not.toBeNull();
    expect(evento.error).toContain("desistiu após 10 tentativas");
  });
});

/**
 * O aviso de download é a ÚNICA chance de guardar uma URL que abre: a que veio
 * na mensagem é a do WhatsApp, criptografada, e o aviso não é reemitido. Por
 * isso ele tem caminho próprio — cair no ramo de status enterrava a URL — e por
 * isso a cobrança é por id, não pelo lote.
 */
describe("webhook da uazapi: mídia baixada", () => {
  it("grava a URL do arquivo sem mexer no status da mensagem", async () => {
    const externalId = `MIDIA_${randomBytes(4).toString("hex")}`;
    await mensagemDeImagem(externalId, "read");

    const resposta = await requisicao(downloadConcluido([externalId]));
    expect(resposta.status).toBe(200);

    const [mensagem] = await db
      .select()
      .from(s.messages)
      .where(and(eq(s.messages.organizationId, organizationId), eq(s.messages.externalId, externalId)));
    expect(mensagem.mediaUrl).toBe(`https://enturos.uazapi.com/files/${externalId}.jpg`);
    expect(mensagem.mediaMimeType).toBe("image/jpeg");
    // O download não é confirmação de entrega: tratá-lo como status regredia a
    // mensagem lida para "enviada".
    expect(mensagem.status).toBe("read");
  });

  it("pede reentrega quando alguma das mensagens citadas ainda não existe", async () => {
    const presente = `MIDIA_OK_${randomBytes(4).toString("hex")}`;
    const ausente = `MIDIA_FALTA_${randomBytes(4).toString("hex")}`;
    await mensagemDeImagem(presente);

    const resposta = await requisicao(downloadConcluido([presente, ausente]));
    // Exigir só que ALGUMA linha tenha casado deixava a outra sem URL para
    // sempre: o aviso chega uma vez só.
    expect(resposta.status).toBe(503);

    const evento = await eventoGravado(`media:${presente},${ausente}`);
    expect(evento.error).toContain(ausente);
    expect(evento.error).not.toContain(presente);
    expect(evento.attempts).toBe(1);

    // A que existia já foi gravada; reaplicar na reentrega é inofensivo.
    const [mensagem] = await db
      .select()
      .from(s.messages)
      .where(and(eq(s.messages.organizationId, organizationId), eq(s.messages.externalId, presente)));
    expect(mensagem.mediaUrl).toBe(`https://enturos.uazapi.com/files/${presente}.jpg`);
  });
});
