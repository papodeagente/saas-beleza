import { randomBytes } from "node:crypto";
import { generateAccountCode } from "@/lib/account-code";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, pool } from "@/db";
import * as s from "@/db/schema";

/**
 * A marca-d'água do agente e a hora do evento.
 *
 * É a mudança de maior risco desta correção, então tem teste próprio. O cenário
 * que a motiva: `syncConversationHistory` grava até 200 mensagens antigas com
 * `created_at` de AGORA. Comparadas por `created_at`, todas passam da
 * marca-d'água de uma vez — e o agente responderia a uma pergunta de julho como
 * se ela tivesse acabado de chegar, no WhatsApp de uma cliente real.
 *
 * O outro lado importa igualmente: a marca é GRAVADA a partir do mesmo carimbo
 * que é COMPARADO. Mudar só um dos lados é pior do que não mudar nenhum —
 * libera a conversa inteira a cada turno, ou a tranca para sempre.
 */

const orquestrador = vi.hoisted(() => ({ executeAgentTurn: vi.fn() }));
vi.mock("@/server/ai/orchestrator", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/ai/orchestrator")>();
  return { ...real, ...orquestrador };
});

/**
 * Sem Redis, `acquireConversationLock` devolve FALSO e TODO turno é pulado com
 * "conversa_travada". A primeira versão deste arquivo passou por esse motivo, e
 * não pela regra que deveria provar — teste verde por acidente é pior do que
 * teste vermelho.
 */
const trava = vi.hoisted(() => ({
  acquireConversationLock: vi.fn(async () => true),
  releaseConversationLock: vi.fn(async () => {}),
  incrementWindow: vi.fn(async () => 1),
}));
vi.mock("@/server/queues/redis", async (importOriginal) => {
  const real = await importOriginal<typeof import("./redis")>();
  return { ...real, ...trava };
});

/**
 * O envio vira espião. Sem isto o turno tentaria falar de verdade com a
 * instância de WhatsApp — e num teste que roda contra o banco de PRODUÇÃO isso
 * é o tipo de coisa que manda mensagem para gente real.
 */
const envio = vi.hoisted(() => ({
  sendMessageToConversation: vi.fn(async () => ({ messageId: 1, externalId: "X" })),
}));
vi.mock("@/server/services/whatsapp-message-service", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/services/whatsapp-message-service")>();
  return { ...real, ...envio };
});

const { processAgentTurn } = await import("./agent-turn-processor");

const SUFIXO = `vitest-turno-${randomBytes(4).toString("hex")}`;
let organizationId = 0;
let conversationId = 0;

const emJulho = new Date("2026-07-15T14:00:00Z");
const marcaEmAgosto = new Date("2026-08-20T10:00:00Z");
const turno = () => ({ organizationId, conversationId, customerId: null });

beforeAll(async () => {
  const [org] = await db
    .insert(s.organizations)
    .values({ publicId: generateAccountCode(), name: `Turno ${SUFIXO}`, slug: `turno-${SUFIXO}` })
    .returning({ id: s.organizations.id });
  organizationId = org.id;

  await db.insert(s.aiAgents).values({
    organizationId,
    name: `Agente ${SUFIXO}`,
    status: "active",
    enabled: true,
    pauseOnHumanReply: false,
    respondGroups: false,
  });

  const [conexao] = await db
    .insert(s.whatsappConnections)
    .values({
      organizationId,
      baseUrl: "https://exemplo.test",
      instanceToken: `tok-${SUFIXO}`,
      webhookToken: randomBytes(12).toString("hex"),
    })
    .returning({ id: s.whatsappConnections.id });

  const [conversa] = await db
    .insert(s.conversations)
    .values({
      organizationId,
      connectionId: conexao.id,
      remoteJid: "5584911112222@s.whatsapp.net",
      status: "open",
      aiLastProcessedInboundAt: marcaEmAgosto,
    })
    .returning({ id: s.conversations.id });
  conversationId = conversa.id;

  // A importação: aconteceu em julho, foi gravada agora.
  await db.insert(s.messages).values({
    organizationId,
    conversationId,
    direction: "inbound",
    sender: "customer",
    body: "Vocês atendem no domingo?",
    externalId: `IMP-${SUFIXO}`,
    sentAt: emJulho,
    createdAt: new Date(),
  });
});

afterAll(async () => {
  await db.delete(s.messages).where(eq(s.messages.organizationId, organizationId));
  await db.delete(s.conversations).where(eq(s.conversations.organizationId, organizationId));
  await db.delete(s.whatsappConnections).where(eq(s.whatsappConnections.organizationId, organizationId));
  await db.delete(s.aiAgents).where(eq(s.aiAgents.organizationId, organizationId));
  await db.delete(s.organizations).where(like(s.organizations.slug, `turno-${SUFIXO}`));
  await pool.end();
});

describe("turno do agente e histórico importado", () => {
  it("não responde a mensagem antiga trazida por importação", async () => {
    // Por `created_at` esta mensagem é de agora e passaria da marca de agosto.
    // Por `coalesce(sent_at, created_at)` ela é de julho, e a marca já a cobre.
    const resultado = await processAgentTurn(turno());
    expect(orquestrador.executeAgentTurn).not.toHaveBeenCalled();
    expect(resultado.status).toBe("skipped");
  });

  it("responde a mensagem que aconteceu DEPOIS da marca", async () => {
    // A forma REAL de `TurnResult`. Com um objeto qualquer, `result.reply.trim()`
    // estoura e o turno vira erro — e a asserção passaria por acidente, de novo.
    orquestrador.executeAgentTurn.mockResolvedValue({
      reply: "Oi! Temos sim.",
      toolsUsed: [],
      usage: { inputTokens: 10, outputTokens: 5 },
      debug: { rounds: 1, model: "teste" },
    });
    const agora = new Date();
    await db.insert(s.messages).values({
      organizationId,
      conversationId,
      direction: "inbound",
      sender: "customer",
      body: "Oi, ainda tem horário hoje?",
      externalId: `NOVA-${SUFIXO}`,
      sentAt: agora,
      createdAt: agora,
    });

    const resultado = await processAgentTurn(turno());
    expect(resultado.status).toBe("sent");
    expect(envio.sendMessageToConversation).toHaveBeenCalledTimes(1);
    expect(orquestrador.executeAgentTurn).toHaveBeenCalledTimes(1);
    // O texto que foi ao modelo é o da mensagem NOVA, sem a de julho junto.
    const argumento = orquestrador.executeAgentTurn.mock.calls[0][0];
    expect(String(argumento.userText)).toContain("ainda tem horário hoje");
    expect(String(argumento.userText)).not.toContain("domingo");
  });

  it("grava a marca na mesma escala em que compara", async () => {
    // Se a marca fosse gravada em hora de gravação e comparada em hora de
    // evento, o próximo turno liberaria a conversa inteira de novo.
    const [conversa] = await db
      .select({ marca: s.conversations.aiLastProcessedInboundAt })
      .from(s.conversations)
      .where(eq(s.conversations.id, conversationId));
    expect(conversa.marca).toBeInstanceOf(Date);
    expect(conversa.marca!.getTime()).toBeGreaterThan(marcaEmAgosto.getTime());

    orquestrador.executeAgentTurn.mockClear();
    const denovo = await processAgentTurn(turno());
    expect(denovo.status).toBe("skipped");
    expect(orquestrador.executeAgentTurn).not.toHaveBeenCalled();
  });
});

describe("empate no mesmo segundo", () => {
  /**
   * O provedor carimba a entrada em SEGUNDOS cheios — 3.196 de 3.196 entradas
   * da base têm milissegundo zerado — enquanto a saída que nós gravamos tem
   * fração. Com a marca-d'água comparada só pela hora, e com `>` estrito, a
   * mensagem da cliente que cai no mesmo segundo da resposta anterior nunca
   * passa. E não passa NUNCA MAIS: a marca não desce.
   *
   * Existe na base: 96 pares de entradas no mesmo segundo, em 25 conversas.
   */
  it("responde a entrada que caiu no MESMO segundo da resposta anterior", async () => {
    const [org] = await db
      .insert(s.organizations)
      .values({
        publicId: generateAccountCode(),
        name: `Empate ${SUFIXO}`,
        slug: `empate-${SUFIXO}`,
      })
      .returning({ id: s.organizations.id });
    await db.insert(s.aiAgents).values({
      organizationId: org.id,
      name: `Agente empate ${SUFIXO}`,
      status: "active",
      enabled: true,
      pauseOnHumanReply: false,
      respondGroups: false,
    });
    const [conexao] = await db
      .insert(s.whatsappConnections)
      .values({
        organizationId: org.id,
        baseUrl: "https://exemplo.test",
        instanceToken: `tok-emp-${SUFIXO}`,
        webhookToken: randomBytes(12).toString("hex"),
      })
      .returning({ id: s.whatsappConnections.id });

    // O segundo cheio da entrada, e a saída nossa com fração DENTRO dele.
    const segundo = new Date("2026-08-25T15:31:00.000Z");
    const nossaSaida = new Date("2026-08-25T15:31:00.900Z");

    const [conversa] = await db
      .insert(s.conversations)
      .values({
        organizationId: org.id,
        connectionId: conexao.id,
        remoteJid: "5584933334444@s.whatsapp.net",
        status: "open",
      })
      .returning({ id: s.conversations.id });

    await db.insert(s.messages).values([
      {
        organizationId: org.id,
        conversationId: conversa.id,
        direction: "outbound",
        sender: "ai",
        body: "Posso ajudar em algo mais?",
        externalId: `OUT-${SUFIXO}`,
        sentAt: nossaSaida,
        createdAt: nossaSaida,
      },
      {
        organizationId: org.id,
        conversationId: conversa.id,
        direction: "inbound",
        sender: "customer",
        body: "Quero marcar sim",
        externalId: `IN-${SUFIXO}`,
        sentAt: segundo,
        createdAt: new Date(nossaSaida.getTime() + 1500),
      },
    ]);

    orquestrador.executeAgentTurn.mockClear();
    orquestrador.executeAgentTurn.mockResolvedValue({
      reply: "Claro!",
      toolsUsed: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      debug: { rounds: 1, model: "teste" },
    });

    const resultado = await processAgentTurn({
      organizationId: org.id,
      conversationId: conversa.id,
      customerId: null,
    });

    expect(resultado.status).toBe("sent");
    const argumento = orquestrador.executeAgentTurn.mock.calls[0][0];
    expect(String(argumento.userText)).toContain("Quero marcar sim");

    await db.delete(s.messages).where(eq(s.messages.organizationId, org.id));
    await db.delete(s.conversations).where(eq(s.conversations.organizationId, org.id));
    await db.delete(s.whatsappConnections).where(eq(s.whatsappConnections.organizationId, org.id));
    await db.delete(s.aiAgents).where(eq(s.aiAgents.organizationId, org.id));
    await db.delete(s.organizations).where(eq(s.organizations.id, org.id));
  });
});
