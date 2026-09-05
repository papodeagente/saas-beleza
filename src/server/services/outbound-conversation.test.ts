import { generateAccountCode } from "@/lib/account-code";
import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pool } from "@/db";
import * as s from "@/db/schema";
import type { TenantContext } from "@/server/auth";
import { _internals, resolveConversation } from "./conversation-resolver";

/**
 * Conversa iniciada pela clínica, contra o Postgres real e com a uazapi
 * simulada.
 *
 * O que está protegido aqui é o conjunto de erros que só aparecem em produção,
 * dias depois, e sempre em silêncio:
 *
 *  - o mesmo celular escrito de duas formas abrindo duas conversas, partindo o
 *    histórico entre o que enviamos e o que a cliente respondeu;
 *  - conversa criada sem mensagem, que a ordenação por `last_message_at desc`
 *    (NULL primeiro, no Postgres) prega no topo de todas as abas;
 *  - cadastro duplicado, porque metade da base guarda telefone sem o 55;
 *  - ficha de cliente deixada para trás por um número que nem WhatsApp tem.
 */

const uazapi = vi.hoisted(() => ({
  checkNumbers: vi.fn(),
  sendText: vi.fn(),
  markChatRead: vi.fn(),
}));

vi.mock("@/server/whatsapp/uazapi-client", async (importOriginal) => {
  // Só as chamadas de rede são trocadas: as classes de erro precisam ser as
  // reais, porque é por `instanceof` que o serviço escolhe o que dizer.
  const real = await importOriginal<typeof import("@/server/whatsapp/uazapi-client")>();
  return { ...real, ...uazapi };
});

const { UazapiError } = await import("@/server/whatsapp/uazapi-client");
const { startOutboundConversation, brPhoneVariants } = await import(
  "./outbound-conversation-service"
);

const SUFFIX = `vitest-ativa-${randomBytes(4).toString("hex")}`;

let ctx: TenantContext;
let organizationId: number;
let connectionId: number;
let userId: number;

/** Resposta de `/chat/check` no formato REAL, conferido contra a instância. */
function checagem(query: string, jid: string | null) {
  return [{ query, exists: jid !== null, jid }];
}

async function conversasDaConta() {
  return db
    .select()
    .from(s.conversations)
    .where(eq(s.conversations.organizationId, organizationId));
}

beforeAll(async () => {
  const [org] = await db
    .insert(s.organizations)
    .values({ publicId: generateAccountCode(), name: "Conversa ativa", slug: SUFFIX, timezone: "America/Sao_Paulo" })
    .returning();
  organizationId = org.id;

  const [user] = await db
    .insert(s.users)
    .values({ name: "Mariana", email: `${SUFFIX}@example.test`, passwordHash: "x" })
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
      status: "connected",
    })
    .returning();
  connectionId = conn.id;

  ctx = {
    organizationId,
    organizationName: "Conversa ativa",
    organizationSlug: SUFFIX,
    organizationCode: "TEST-0000",
    timezone: "America/Sao_Paulo",
    userId,
    userName: "Mariana",
    userEmail: `${SUFFIX}@example.test`,
    role: "owner",
  };
});

beforeEach(() => {
  // Marcar como lida no aparelho é melhor esforço dentro do envio, mas o
  // serviço encadeia `.catch()` nela: um dublê que devolve `undefined` derruba
  // o envio inteiro por TypeError — e o teste passaria a medir outra coisa.
  uazapi.markChatRead.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(async () => {
  // Por organização, e não pela lista de conversas lidas antes: o banco é
  // compartilhado com o desenvolvimento, e um teste que falhe no meio não pode
  // deixar linha para trás.
  await db.delete(s.messages).where(eq(s.messages.organizationId, organizationId));
  await db.delete(s.conversations).where(eq(s.conversations.organizationId, organizationId));
  await db.delete(s.customers).where(eq(s.customers.organizationId, organizationId));
  await db.delete(s.whatsappConnections).where(eq(s.whatsappConnections.organizationId, organizationId));
  await db.delete(s.organizationMembers).where(eq(s.organizationMembers.organizationId, organizationId));
  await db.delete(s.users).where(eq(s.users.id, userId));
  await db.delete(s.organizations).where(eq(s.organizations.id, organizationId));
  await pool.end();
});

describe("iniciar conversa pela clínica", () => {
  it("usa o JID que o WhatsApp devolve, mesmo sem o nono dígito, e atribui a conversa a quem escreveu", async () => {
    // Caso real: telefone 5592985621979, JID 559285621979@s.whatsapp.net.
    uazapi.checkNumbers.mockResolvedValue(checagem("5592985621979", "559285621979@s.whatsapp.net"));
    uazapi.sendText.mockResolvedValue({ messageId: `M_${randomBytes(4).toString("hex")}`, status: "sent" });

    const resultado = await startOutboundConversation(ctx, {
      phone: "(92) 98562-1979",
      name: "Joana",
      body: "Oi, Joana! Aqui é da clínica.",
    });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.reused).toBe(false);

    const [conversa] = await db
      .select()
      .from(s.conversations)
      .where(eq(s.conversations.id, resultado.conversationId));

    // O endereço é o do WhatsApp, não o montado a partir do telefone.
    expect(conversa.remoteJid).toBe("559285621979@s.whatsapp.net");
    expect(conversa.phone).toBe("5592985621979");
    // Nasce com dono: a fila é regra de mensagem RECEBIDA.
    expect(conversa.assignedUserId).toBe(userId);
    expect(conversa.controlledBy).toBe("human");
    expect(conversa.status).toBe("open");
    expect(conversa.startedByUserId).toBe(userId);

    const enviadas = await db
      .select()
      .from(s.messages)
      .where(eq(s.messages.conversationId, resultado.conversationId));
    expect(enviadas).toHaveLength(1);
    expect(enviadas[0].direction).toBe("outbound");
    expect(enviadas[0].senderUserId).toBe(userId);
  });

  it("manda para a MESMA conversa quando o número é digitado sem o nono dígito", async () => {
    uazapi.sendText.mockResolvedValue({ messageId: `M_${randomBytes(4).toString("hex")}`, status: "sent" });

    const resultado = await startOutboundConversation(ctx, {
      // Mesma pessoa do teste anterior, escrita sem o nono dígito.
      phone: "559285621979",
      name: "Joana",
      body: "Esqueci de dizer uma coisa.",
    });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.reused).toBe(true);

    // Reuso é decidido no banco: nem chega a perguntar ao WhatsApp.
    expect(uazapi.checkNumbers).not.toHaveBeenCalled();

    const conversas = (await conversasDaConta()).filter((c) => c.phone === "5592985621979");
    expect(conversas).toHaveLength(1);
    expect(conversas[0].id).toBe(resultado.conversationId);
  });

  it("não cria nada quando o número não tem WhatsApp", async () => {
    uazapi.checkNumbers.mockResolvedValue(checagem("5511999990000", null));
    uazapi.sendText.mockResolvedValue({ messageId: "nunca", status: "sent" });

    const resultado = await startOutboundConversation(ctx, {
      phone: "11999990000",
      name: "Número Errado",
      body: "oi",
    });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.code).toBe("SEM_WHATSAPP");
    expect(resultado.error).toBe(
      "Esse número não tem WhatsApp. Confira com a cliente antes de tentar de novo.",
    );

    expect(uazapi.sendText).not.toHaveBeenCalled();
    const conversas = (await conversasDaConta()).filter((c) => c.phone === "5511999990000");
    expect(conversas).toHaveLength(0);
    // Nem a ficha da cliente: um número errado não deixa cadastro para trás.
    const clientes = await db
      .select()
      .from(s.customers)
      .where(
        and(eq(s.customers.organizationId, organizationId), eq(s.customers.phone, "5511999990000")),
      );
    expect(clientes).toHaveLength(0);
  });

  it("não deixa conversa órfã quando o envio falha", async () => {
    uazapi.checkNumbers.mockResolvedValue(checagem("5511988887777", "5511988887777@s.whatsapp.net"));
    uazapi.sendText.mockRejectedValue(new UazapiError("uazapi POST /send/text → 500", 500, ""));

    const resultado = await startOutboundConversation(ctx, {
      phone: "11988887777",
      name: "Bruna",
      body: "oi",
    });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.code).toBe("ENVIO_FALHOU");

    /**
     * Uma conversa sem mensagem tem `last_message_at` nulo, e o Postgres ordena
     * NULL PRIMEIRO em `desc` — ela ficaria grudada no topo de todas as abas do
     * inbox, para todo o time, sem nada dentro.
     */
    const conversas = (await conversasDaConta()).filter((c) => c.phone === "5511988887777");
    expect(conversas).toHaveLength(0);

    const clientes = await db
      .select()
      .from(s.customers)
      .where(
        and(eq(s.customers.organizationId, organizationId), eq(s.customers.phone, "5511988887777")),
      );
    expect(clientes).toHaveLength(0);
  });

  it("não engole a mensagem que JÁ saiu quando a falha vem depois do envio", async () => {
    uazapi.checkNumbers.mockResolvedValue(checagem("5511977776666", "5511977776666@s.whatsapp.net"));
    uazapi.sendText.mockResolvedValue({ messageId: `M_${randomBytes(4).toString("hex")}`, status: "sent" });
    /**
     * O WhatsApp aceitou e a mensagem foi gravada; quem quebra é o passo
     * seguinte, dentro do mesmo envio. É a única situação em que a limpeza
     * apagaria uma mensagem que a cliente já recebeu — e é justamente a que a
     * guarda de `apagarConversaVazia` existe para impedir.
     */
    uazapi.markChatRead.mockReturnValue(undefined as never);

    const resultado = await startOutboundConversation(ctx, {
      phone: "11977776666",
      name: "Clara",
      body: "Oi, Clara!",
    });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;

    const conversas = (await conversasDaConta()).filter((c) => c.phone === "5511977776666");
    expect(conversas).toHaveLength(1);
    const enviadas = await db
      .select()
      .from(s.messages)
      .where(eq(s.messages.conversationId, conversas[0].id));
    expect(enviadas).toHaveLength(1);

    // A conversa fica com dono: ela existe, tem mensagem e precisa aparecer para
    // quem escreveu, não na fila como se ninguém tivesse falado com a cliente.
    expect(conversas[0].assignedUserId).toBe(userId);

    // E o aviso NÃO pode dizer que nada aconteceu: a cliente recebeu. Mandar
    // "tente de novo" aqui é pedir para a mensagem chegar duas vezes.
    expect(resultado.error).not.toContain("não foi aberta");
    expect(resultado.error).toContain("confira");
  });

  it("não diz que a mensagem saiu quando a conversa já tinha histórico e o envio falhou", async () => {
    // A conversa da Joana, dos dois primeiros casos, já tem mensagens. Se a
    // detecção fosse "a conversa tem mensagem" em vez de "esta chamada gravou
    // uma", toda falha aqui viraria um "confira antes de reenviar" mentiroso —
    // e a mensagem nunca sairia.
    uazapi.sendText.mockRejectedValue(new UazapiError("uazapi POST /send/text → 500", 500, ""));

    const resultado = await startOutboundConversation(ctx, {
      phone: "5592985621979",
      name: "Joana",
      body: "não vai sair",
    });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.code).toBe("ENVIO_FALHOU");
    expect(resultado.error).not.toContain("confira");
  });

  it("não apaga a conversa que já existia sem JID quando o envio falha", async () => {
    // Conversa aberta por outro caminho, ainda sem endereço no WhatsApp — o
    // resolver adota essa em vez de criar uma segunda. Ela NÃO nasceu nesta
    // chamada, então a limpeza não tem direito sobre ela nem sobre o histórico
    // que já está dentro.
    const [cliente] = await db
      .insert(s.customers)
      .values({ organizationId, name: "Órfã", phone: "5511966665555", source: "manual" })
      .returning();
    const [orfa] = await db
      .insert(s.conversations)
      .values({ organizationId, customerId: cliente.id, channel: "whatsapp" })
      .returning();
    await db.insert(s.messages).values({
      organizationId,
      conversationId: orfa.id,
      direction: "inbound",
      sender: "customer",
      body: "mensagem antiga",
      messageType: "text",
      status: "delivered",
      externalId: `X_${randomBytes(4).toString("hex")}`,
    });

    uazapi.checkNumbers.mockResolvedValue(checagem("5511966665555", "5511966665555@s.whatsapp.net"));
    uazapi.sendText.mockRejectedValue(new UazapiError("uazapi POST /send/text → 500", 500, ""));

    const resultado = await startOutboundConversation(ctx, { customerId: cliente.id, body: "oi" });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.code).toBe("ENVIO_FALHOU");
    // Nada saiu: o aviso não pode mandar conferir uma mensagem que não existe.
    expect(resultado.error).not.toContain("confira");

    const [depois] = await db.select().from(s.conversations).where(eq(s.conversations.id, orfa.id));
    expect(depois).toBeDefined();
    // Prova de que foi mesmo a órfã que o resolver adotou, e não uma conversa
    // nova criada ao lado dela.
    expect(depois.remoteJid).toBe("5511966665555@s.whatsapp.net");
    const daCliente = (await conversasDaConta()).filter((c) => c.customerId === cliente.id);
    expect(daCliente).toHaveLength(1);
    const historico = await db
      .select()
      .from(s.messages)
      .where(eq(s.messages.conversationId, orfa.id));
    expect(historico).toHaveLength(1);
  });

  it("não duplica o cadastro da cliente cujo telefone foi gravado sem o 55", async () => {
    // Como o cadastro da recepção grava: só dígitos, sem código de país.
    const [antiga] = await db
      .insert(s.customers)
      .values({ organizationId, name: "Rita Antiga", phone: "11976543210", source: "manual" })
      .returning();

    uazapi.checkNumbers.mockResolvedValue(checagem("5511976543210", "5511976543210@s.whatsapp.net"));
    uazapi.sendText.mockResolvedValue({ messageId: `M_${randomBytes(4).toString("hex")}`, status: "sent" });

    const resultado = await startOutboundConversation(ctx, {
      phone: "(11) 97654-3210",
      name: "Rita Nova",
      body: "oi",
    });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.customerId).toBe(antiga.id);

    const clientes = await db
      .select()
      .from(s.customers)
      .where(
        and(
          eq(s.customers.organizationId, organizationId),
          inArray(s.customers.phone, brPhoneVariants("5511976543210")),
        ),
      );
    expect(clientes).toHaveLength(1);
    // O nome digitado agora não passa por cima do que está na ficha.
    expect(clientes[0].name).toBe("Rita Antiga");
  });

  it("fala com a cliente escolhida na lista mesmo com o telefone dela gravado sem o 55", async () => {
    const [cliente] = await db
      .insert(s.customers)
      .values({ organizationId, name: "Carla", phone: "11985554444", source: "manual" })
      .returning();

    // O WhatsApp dela responde sem o nono dígito — e é esse o endereço válido.
    uazapi.checkNumbers.mockResolvedValue(checagem("5511985554444", "551185554444@s.whatsapp.net"));
    uazapi.sendText.mockResolvedValue({ messageId: `M_${randomBytes(4).toString("hex")}`, status: "sent" });

    const resultado = await startOutboundConversation(ctx, {
      customerId: cliente.id,
      body: "Oi, Carla!",
    });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.customerId).toBe(cliente.id);

    const [conversa] = await db
      .select()
      .from(s.conversations)
      .where(eq(s.conversations.id, resultado.conversationId));
    expect(conversa.customerId).toBe(cliente.id);

    const clientes = await db
      .select()
      .from(s.customers)
      .where(
        and(
          eq(s.customers.organizationId, organizationId),
          inArray(s.customers.phone, brPhoneVariants("5511985554444")),
        ),
      );
    expect(clientes).toHaveLength(1);
  });

  it("recusa em vez de arriscar quando a verificação não responde", async () => {
    uazapi.checkNumbers.mockRejectedValue(new UazapiError("timeout", 0, ""));
    uazapi.sendText.mockResolvedValue({ messageId: "nunca", status: "sent" });

    const resultado = await startOutboundConversation(ctx, {
      phone: "11933332222",
      name: "Sem resposta",
      body: "oi",
    });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.code).toBe("VERIFICACAO_INDISPONIVEL");
    // "Manda assim mesmo" seria enviar para um endereço inventado.
    expect(uazapi.sendText).not.toHaveBeenCalled();
    expect((await conversasDaConta()).filter((c) => c.phone === "5511933332222")).toHaveLength(0);
  });

  it("nem procura o número quando o WhatsApp da clínica está desconectado", async () => {
    await db
      .update(s.whatsappConnections)
      .set({ status: "disconnected" })
      .where(eq(s.whatsappConnections.id, connectionId));

    const resultado = await startOutboundConversation(ctx, {
      phone: "11922221111",
      name: "Qualquer",
      body: "oi",
    });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.code).toBe("DESCONECTADO");
    expect(uazapi.checkNumbers).not.toHaveBeenCalled();

    await db
      .update(s.whatsappConnections)
      .set({ status: "connected" })
      .where(eq(s.whatsappConnections.id, connectionId));
  });

  it("exige o nome no número digitado, para o cadastro não nascer chamado pelo telefone", async () => {
    const resultado = await startOutboundConversation(ctx, {
      phone: "11911112222",
      name: "   ",
      body: "oi",
    });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.code).toBe("NOME_OBRIGATORIO");
    expect(uazapi.checkNumbers).not.toHaveBeenCalled();
  });
});

describe("leitura da resposta de /chat/check", () => {
  /**
   * Corpo COPIADO da instância real (enturos.uazapi.com, 23/08/2026) para os
   * números 5584981282118 (existe) e 5511999990000 (não existe).
   *
   * A resposta é um array cru, o campo é `isInWhatsapp` — não `exists`, não
   * `isInWhatsApp` — e o número inexistente vem com `jid` em BRANCO, não nulo.
   * Ler o nome errado faria todo número válido parecer inexistente, e o recurso
   * recusaria 100% dos casos legítimos em silêncio.
   */
  const CORPO_REAL =
    '[{"query":"5584981282118","isInWhatsapp":true,"jid":"558481282118@s.whatsapp.net","lid":"98398321524913@lid","verifiedName":""},' +
    '{"query":"5511999990000","isInWhatsapp":false,"jid":"","verifiedName":"","error":"the number 5511999990000@s.whatsapp.net is not on WhatsApp"}]';

  it("entende o formato que a instância devolve de verdade", async () => {
    const real = await vi.importActual<typeof import("@/server/whatsapp/uazapi-client")>(
      "@/server/whatsapp/uazapi-client",
    );
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(CORPO_REAL, { status: 200 })) as typeof fetch;
    try {
      const linhas = await real.checkNumbers(
        { baseUrl: "https://invalido.test", token: "x" },
        ["5584981282118", "5511999990000"],
      );
      expect(linhas).toEqual([
        { query: "5584981282118", exists: true, jid: "558481282118@s.whatsapp.net" },
        { query: "5511999990000", exists: false, jid: null },
      ]);
      // O JID vem SEM o nono dígito que o telefone tem: é por isso que ele não
      // pode ser montado a partir do número.
      expect(linhas[0].jid).not.toContain("5584981282118");
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  });
});

describe("formas do mesmo telefone", () => {
  it("cobre as quatro escritas de um celular brasileiro", () => {
    expect(new Set(brPhoneVariants("(84) 98128-2118"))).toEqual(
      new Set(["5584981282118", "84981282118", "8481282118", "558481282118"]),
    );
  });

  it("não inventa nono dígito para telefone fixo", () => {
    expect(new Set(brPhoneVariants("11 5192-1424"))).toEqual(
      new Set(["551151921424", "1151921424"]),
    );
  });
});

describe("nome provisório do cadastro", () => {
  /**
   * `formatBrPhone` escreve "(27) 98102-7211" (11 dígitos) e o telefone é
   * guardado como 5527981027211 (13). Comparados crus nunca coincidem, e por
   * isso o nome provisório sobrevivia para sempre — o caso está no banco de
   * produção: clientes 63 e 64 da organização 1.
   */
  it("reconhece o telefone formatado como nome provisório", () => {
    expect(_internals.isPlaceholderName("(27) 98102-7211", "5527981027211")).toBe(true);
    expect(_internals.isPlaceholderName("(11) 5192-1424", "551151921424")).toBe(true);
  });

  it("não confunde nome de gente com telefone", () => {
    expect(_internals.isPlaceholderName("Studio 2024", "5511987654321")).toBe(false);
    expect(_internals.isPlaceholderName("Mariana", "5511987654321")).toBe(false);
    expect(_internals.isPlaceholderName("(11) 98888-7777", "5511987654321")).toBe(false);
  });

  it("troca o nome provisório pelo nome real quando o WhatsApp o informa", async () => {
    const [cliente] = await db
      .insert(s.customers)
      .values({
        organizationId,
        name: "(27) 98102-7211",
        phone: "5527981027211",
        source: "whatsapp",
      })
      .returning();

    await resolveConversation({
      organizationId,
      connectionId,
      remoteJid: "5527981027211@s.whatsapp.net",
      phone: "5527981027211",
      contactName: "Letícia",
      isGroup: false,
    });

    const [depois] = await db.select().from(s.customers).where(eq(s.customers.id, cliente.id));
    expect(depois.name).toBe("Letícia");
  });
});
