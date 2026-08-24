import { generateAccountCode } from "@/lib/account-code";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import * as s from "@/db/schema";
import type { NormalizedMessage } from "@/server/whatsapp/normalizer";
import {
  applyStatusUpdate,
  ingestMessage,
  MensagemAindaNaoGravadaError,
} from "./whatsapp-message-service";

/**
 * Ingestão de mensagem contra o Postgres real.
 *
 * O que está sendo protegido aqui são as três regras que, quando quebram,
 * quebram calado: reentrega do webhook virando mensagem duplicada, conversa
 * resolvida que não volta para a fila quando o cliente escreve de novo, e
 * cliente novo cadastrado duas vezes porque o telefone chegou em formato
 * diferente.
 */

const SUFFIX = `vitest-ingest-${randomBytes(4).toString("hex")}`;

let organizationId: number;
let connection: typeof s.whatsappConnections.$inferSelect;
let userId: number;

function message(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    externalId: `MSG_${randomBytes(6).toString("hex")}`,
    remoteJid: "5511955550001@s.whatsapp.net",
    fromMe: false,
    isGroup: false,
    phone: "5511955550001",
    senderName: "Cliente Teste",
    senderPhone: null,
    groupName: null,
    kind: "text",
    body: "oi",
    mediaUrl: null,
    mediaMimeType: null,
    mediaFileName: null,
    quotedExternalId: null,
    status: null,
    sentAt: new Date(),
    ...overrides,
  };
}

beforeAll(async () => {
  const [org] = await db
    .insert(s.organizations)
    .values({ publicId: generateAccountCode(), name: "Ingest", slug: SUFFIX, timezone: "America/Sao_Paulo" })
    .returning();
  organizationId = org.id;

  const [user] = await db
    .insert(s.users)
    .values({ name: "Atendente", email: `${SUFFIX}@example.test`, passwordHash: "x" })
    .returning();
  userId = user.id;
  await db.insert(s.organizationMembers).values({ organizationId, userId, role: "owner" });

  const [conn] = await db
    .insert(s.whatsappConnections)
    .values({
      organizationId,
      baseUrl: "https://invalido.test",
      instanceToken: "x",
      webhookToken: SUFFIX,
    })
    .returning();
  connection = conn;
});

afterAll(async () => {
  const convs = await db
    .select({ id: s.conversations.id })
    .from(s.conversations)
    .where(eq(s.conversations.organizationId, organizationId));
  for (const conv of convs) {
    await db.delete(s.messages).where(eq(s.messages.conversationId, conv.id));
  }
  await db.delete(s.conversations).where(eq(s.conversations.organizationId, organizationId));
  await db.delete(s.customers).where(eq(s.customers.organizationId, organizationId));
  await db.delete(s.whatsappConnections).where(eq(s.whatsappConnections.organizationId, organizationId));
  await db.delete(s.organizationMembers).where(eq(s.organizationMembers.organizationId, organizationId));
  await db.delete(s.users).where(eq(s.users.id, userId));
  await db.delete(s.organizations).where(eq(s.organizations.id, organizationId));
  await pool.end();
});

describe("ingestão de mensagem recebida", () => {
  it("cria conversa e cliente na primeira mensagem, e deixa a conversa na fila", async () => {
    const result = await ingestMessage(connection, message({ body: "oi, queria marcar" }));

    expect(result.isNew).toBe(true);
    expect(result.isInbound).toBe(true);
    expect(result.customerId).not.toBeNull();

    const [conversation] = await db
      .select()
      .from(s.conversations)
      .where(eq(s.conversations.id, result.conversationId));
    expect(conversation.assignedUserId).toBeNull();
    expect(conversation.unreadCount).toBe(1);

    const [customer] = await db
      .select()
      .from(s.customers)
      .where(eq(s.customers.id, result.customerId!));
    expect(customer.name).toBe("Cliente Teste");
    expect(customer.source).toBe("whatsapp");
  });

  it("ignora a reentrega do mesmo evento em vez de duplicar a mensagem", async () => {
    const msg = message({ body: "mesma mensagem" });
    const first = await ingestMessage(connection, msg);
    const second = await ingestMessage(connection, msg);

    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);

    const saved = await db
      .select()
      .from(s.messages)
      .where(and(eq(s.messages.organizationId, organizationId), eq(s.messages.externalId, msg.externalId)));
    expect(saved).toHaveLength(1);
  });

  it("não cadastra o mesmo cliente duas vezes quando o telefone chega sem o nono dígito", async () => {
    await ingestMessage(
      connection,
      message({ remoteJid: "5521988887777@s.whatsapp.net", phone: "5521988887777", senderName: "Rita" }),
    );
    await ingestMessage(
      connection,
      message({ remoteJid: "552188887777@s.whatsapp.net", phone: "552188887777", senderName: "Rita" }),
    );

    const rows = await db
      .select()
      .from(s.customers)
      .where(and(eq(s.customers.organizationId, organizationId), eq(s.customers.phone, "5521988887777")));
    expect(rows).toHaveLength(1);
  });

  it("mantém uma conversa só quando o WhatsApp muda o nono dígito do JID", async () => {
    // Caso real: enviamos para 5592985621979 e a resposta chegou de
    // 559285621979. Sem deduplicar por telefone, o histórico se parte em dois.
    const enviado = await ingestMessage(
      connection,
      message({
        remoteJid: "5592985621979@s.whatsapp.net",
        phone: "5592985621979",
        fromMe: true,
        body: "oi, tudo bem?",
      }),
    );

    const respondido = await ingestMessage(
      connection,
      message({
        remoteJid: "559285621979@s.whatsapp.net",
        phone: "559285621979",
        body: "tudo bem?",
      }),
    );

    expect(respondido.conversationId).toBe(enviado.conversationId);

    const [conversation] = await db
      .select()
      .from(s.conversations)
      .where(eq(s.conversations.id, enviado.conversationId));
    // Passa a valer o JID que o WhatsApp está usando: é para ele que o envio vai.
    expect(conversation.remoteJid).toBe("559285621979@s.whatsapp.net");

    const both = await db
      .select()
      .from(s.messages)
      .where(eq(s.messages.conversationId, enviado.conversationId));
    expect(both.length).toBeGreaterThanOrEqual(2);
  });

  it("devolve para a fila a conversa já resolvida, guardando quem atendeu antes", async () => {
    const first = await ingestMessage(
      connection,
      message({ remoteJid: "5511944443333@s.whatsapp.net", phone: "5511944443333" }),
    );

    // Uma atendente assume e resolve.
    await db
      .update(s.conversations)
      .set({ assignedUserId: userId, status: "closed", resolvedAt: new Date(), resolvedByUserId: userId })
      .where(eq(s.conversations.id, first.conversationId));

    await ingestMessage(
      connection,
      message({ remoteJid: "5511944443333@s.whatsapp.net", phone: "5511944443333", body: "voltei" }),
    );

    const [conversation] = await db
      .select()
      .from(s.conversations)
      .where(eq(s.conversations.id, first.conversationId));

    expect(conversation.status).toBe("open");
    expect(conversation.assignedUserId).toBeNull();
    expect(conversation.lastAssignedUserId).toBe(userId);
  });

  it("registra mensagem enviada do celular como humana, sem dono", async () => {
    const result = await ingestMessage(
      connection,
      message({ remoteJid: "5511933332222@s.whatsapp.net", phone: "5511933332222", fromMe: true, body: "já respondi por aqui" }),
    );

    const [saved] = await db.select().from(s.messages).where(eq(s.messages.id, result.messageId!));
    expect(saved.direction).toBe("outbound");
    expect(saved.sender).toBe("user");
    expect(saved.senderUserId).toBeNull();
  });
});

/**
 * Status: o provedor manda, o banco obedece — só que nunca para trás.
 *
 * Estes dois defeitos foram medidos em produção em 24/08/2026: 627 mensagens
 * de saída paradas em "enviada" enquanto a uazapi respondia "Read" para elas,
 * e 50 confirmações de entrega processadas contra linha inexistente, perdidas
 * para sempre porque o handler devolvia em silêncio.
 */
describe("status do provedor", () => {
  const jid = "5511922221111@s.whatsapp.net";

  it("grava o status que a uazapi informa em vez de cravar 'enviada'", async () => {
    const result = await ingestMessage(
      connection,
      message({ externalId: "STATUS_READ_1", remoteJid: jid, phone: "5511922221111", fromMe: true, body: "confirmado", status: "read" }),
    );
    const [saved] = await db.select().from(s.messages).where(eq(s.messages.id, result.messageId!));
    expect(saved.status).toBe("read");
  });

  it("cura retroativamente a mensagem presa quando a reconciliação relê o status", async () => {
    const msg = message({ externalId: "STATUS_PRESA_1", remoteJid: jid, phone: "5511922221111", fromMe: true, body: "oi" });
    const primeira = await ingestMessage(connection, msg);
    const [antes] = await db.select().from(s.messages).where(eq(s.messages.id, primeira.messageId!));
    expect(antes.status).toBe("sent");

    // Segunda passada: é o que o /message/find faz ao reabrir a conversa.
    const releitura = await ingestMessage(connection, { ...msg, status: "read" });
    expect(releitura.isNew).toBe(false);
    expect(releitura.isUpdated).toBe(true);

    const [depois] = await db.select().from(s.messages).where(eq(s.messages.id, primeira.messageId!));
    expect(depois.status).toBe("read");
  });

  it("nunca regride de lida para enviada", async () => {
    const msg = message({ externalId: "STATUS_MONOTONO_1", remoteJid: jid, phone: "5511922221111", fromMe: true, body: "oi", status: "read" });
    const criada = await ingestMessage(connection, msg);
    await ingestMessage(connection, { ...msg, status: "sent" });

    const [saved] = await db.select().from(s.messages).where(eq(s.messages.id, criada.messageId!));
    expect(saved.status).toBe("read");
  });

  it("recusa a confirmação de uma mensagem que ainda não existe, para ela ser reentregue", async () => {
    // O `return` silencioso de antes marcava o evento como processado com
    // sucesso: a confirmação sumia e a mensagem ficava "enviada" para sempre.
    await expect(applyStatusUpdate(connection, "NUNCA_GRAVADA_1", "delivered")).rejects.toBeInstanceOf(
      MensagemAindaNaoGravadaError,
    );
  });
});
