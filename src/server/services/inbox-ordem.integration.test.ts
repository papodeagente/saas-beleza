import { randomBytes } from "node:crypto";
import { generateAccountCode } from "@/lib/account-code";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import * as s from "@/db/schema";
import type { TenantContext } from "@/server/auth";
import { getConversation, listConversations } from "./inbox-service";

/**
 * A ordem do fio é a ordem em que as coisas ACONTECERAM.
 *
 * `messages` tem dois carimbos: `sent_at`, que é quando a mensagem aconteceu no
 * WhatsApp, e `created_at`, que é quando NÓS gravamos a linha. Para mensagem que
 * chega ao vivo os dois são quase iguais e ninguém nota. Para mensagem importada
 * do histórico, todas nascem com `created_at = now()` da importação, carregando
 * o `sent_at` verdadeiro e antigo.
 *
 * Medido em produção: 3.219 de 4.534 mensagens têm mais de 5 minutos de
 * diferença entre os dois, e 34 das 158 conversas mudam de ordem por causa
 * disso. Caso real da conversa 443: mensagens de 31/07 gravadas em 25/08 03:41
 * apareciam ENTRE as de 25/08 12:00 e as de 26/08 00:24.
 */

const SUFIXO = `vitest-ordem-${randomBytes(4).toString("hex")}`;
let organizationId = 0;
let conversationId = 0;
let ctx: TenantContext;

const emJulho = new Date("2026-07-31T18:00:00Z");
const ontem = new Date(Date.now() - 24 * 3600 * 1000);
const importadaEm = new Date(Date.now() - 2 * 3600 * 1000);

beforeAll(async () => {
  const [org] = await db
    .insert(s.organizations)
    .values({ publicId: generateAccountCode(), name: `Ordem ${SUFIXO}`, slug: `ordem-${SUFIXO}` })
    .returning({ id: s.organizations.id });
  organizationId = org.id;
  ctx = { organizationId, userId: 1, role: "owner" } as TenantContext;

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
      remoteJid: `5584900000000@s.whatsapp.net`,
      status: "open",
    })
    .returning({ id: s.conversations.id });
  conversationId = conversa.id;

  // A ordem em que as linhas foram GRAVADAS é de propósito diferente da ordem
  // em que as mensagens aconteceram: é exatamente o que a importação produz.
  await db.insert(s.messages).values([
    {
      organizationId,
      conversationId,
      direction: "inbound",
      sender: "customer",
      body: "1 — julho, importada depois",
      externalId: `A-${SUFIXO}`,
      sentAt: emJulho,
      createdAt: importadaEm,
    },
    {
      organizationId,
      conversationId,
      direction: "outbound",
      sender: "user",
      body: "2 — ontem, ao vivo",
      externalId: `B-${SUFIXO}`,
      sentAt: ontem,
      createdAt: ontem,
    },
  ]);
});

afterAll(async () => {
  await db.delete(s.messages).where(eq(s.messages.organizationId, organizationId));
  await db.delete(s.conversations).where(eq(s.conversations.organizationId, organizationId));
  await db.delete(s.whatsappConnections).where(eq(s.whatsappConnections.organizationId, organizationId));
  await db.delete(s.organizations).where(like(s.organizations.slug, `ordem-${SUFIXO}`));
  await pool.end();
});

describe("ordem do fio", () => {
  it("põe a mensagem de julho ANTES da de ontem, mesmo tendo sido gravada depois", async () => {
    const conversa = await getConversation(ctx, conversationId);
    const corpos = (conversa?.messages ?? []).map((m) => m.body);
    expect(corpos).toEqual(["1 — julho, importada depois", "2 — ontem, ao vivo"]);
  });

  it("mostra o horário em que a mensagem aconteceu, não o da importação", async () => {
    // Sem isto, a mensagem de julho aparece com o separador de data de hoje: o
    // fio fica na ordem certa e a data continua mentindo.
    const conversa = await getConversation(ctx, conversationId);
    const julho = (conversa?.messages ?? []).find((m) => m.body?.startsWith("1 —"));
    expect(julho).toBeTruthy();
    /**
     * `Date`, e não texto.
     *
     * Expressão SQL crua perde o mapeamento de tipo da coluna e o driver
     * devolve string. A primeira versão desta correção fez exatamente isso: os
     * testes passaram, porque `new Date(texto)` funciona, e a tela quebrou com
     * "message.createdAt.toISOString is not a function" — o fio inteiro sumiu.
     */
    expect(julho!.createdAt).toBeInstanceOf(Date);
    expect(julho!.createdAt.toISOString()).toBe(emJulho.toISOString());
  });
});

describe("empates e ausências", () => {
  it("desempata pelo id quando duas mensagens caem no mesmo segundo", async () => {
    // O provedor manda o carimbo em SEGUNDOS: em produção há 183 linhas
    // empatadas. Sem o desempate, duas mensagens do mesmo segundo trocam de
    // lugar entre dois carregamentos da mesma tela.
    const mesmoInstante = new Date("2026-08-01T12:00:00.000Z");
    await db.insert(s.messages).values([
      {
        organizationId,
        conversationId,
        direction: "inbound",
        sender: "customer",
        body: "empate A",
        externalId: `EA-${SUFIXO}`,
        sentAt: mesmoInstante,
      },
      {
        organizationId,
        conversationId,
        direction: "inbound",
        sender: "customer",
        body: "empate B",
        externalId: `EB-${SUFIXO}`,
        sentAt: mesmoInstante,
      },
    ]);

    const primeira = await getConversation(ctx, conversationId);
    const segunda = await getConversation(ctx, conversationId);
    const corpos = (lista: typeof primeira) =>
      (lista?.messages ?? []).map((m) => m.body).filter((b) => b?.startsWith("empate"));

    expect(corpos(primeira)).toEqual(["empate A", "empate B"]);
    expect(corpos(segunda)).toEqual(corpos(primeira));
  });

  it("mensagem sem sent_at fica no lugar do created_at, e não no topo", async () => {
    // `order by sent_at desc` puro põe NULO PRIMEIRO no Postgres: as seis
    // mensagens de demonstração sem carimbo pulariam para o alto do fio.
    await db.insert(s.messages).values({
      organizationId,
      conversationId,
      direction: "inbound",
      sender: "customer",
      body: "sem carimbo, gravada em junho",
      externalId: `SC-${SUFIXO}`,
      sentAt: null,
      createdAt: new Date("2026-06-01T10:00:00.000Z"),
    });

    const conversa = await getConversation(ctx, conversationId);
    const corpos = (conversa?.messages ?? []).map((m) => m.body);
    expect(corpos[0]).toBe("sem carimbo, gravada em junho");
  });

  it("a prévia da lista é a fala mais recente de verdade", async () => {
    // A linha é POSICIONADA por hora real e EXIBIA a última linha gravada:
    // ocupava o lugar de uma mensagem e mostrava a frase de outra.
    const lista = await listConversations(ctx, { tab: "todos" });
    const nossa = lista.find((c) => c.id === conversationId);
    expect(nossa).toBeTruthy();
    expect(nossa!.lastMessagePreview).toBe("2 — ontem, ao vivo");
  });
});
