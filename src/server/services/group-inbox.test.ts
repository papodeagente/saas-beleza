import { generateAccountCode } from "@/lib/account-code";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import * as s from "@/db/schema";
import type { TenantContext } from "@/server/auth";
import {
  getGroupThread,
  identidadeBase,
  listGroupInbox,
  montarPrevia,
  montarPreviaLocal,
  nomearParticipantes,
} from "./group-inbox-service";

/**
 * A lista de grupos tinha que contar três mentiras ao mesmo tempo para ficar
 * como o dono a encontrou: sem prévia (só 2 dos 30 grupos da primeira página
 * mostravam a última mensagem), fora de ordem (nada de atividade recente) e
 * com a DESCRIÇÃO do grupo ocupando o lugar da fala. Os testes abaixo fixam as
 * três regras que consertam isso, além do empate entre as duas fontes de
 * verdade — mensagem nossa e retrato do aparelho.
 */

const SUFFIX = `vitest-grupos-${randomBytes(4).toString("hex")}`;
const NOSSO_NUMERO = "5584999990000";
let organizationId: number;
let connectionId: number;
let ctx: TenantContext;

const agora = Date.now();
const emMinutos = (m: number) => new Date(agora - m * 60_000);

async function criarGrupo(jid: string, valores: Partial<typeof s.whatsappGroups.$inferInsert> = {}) {
  await db.insert(s.whatsappGroups).values({ organizationId, connectionId, jid, name: jid, ...valores });
}

async function criarConversaComMensagem(
  jid: string,
  mensagem: Partial<typeof s.messages.$inferInsert>,
  lastMessageAt: Date,
  extras: Partial<typeof s.conversations.$inferInsert> = {},
) {
  const [conversa] = await db
    .insert(s.conversations)
    .values({ organizationId, connectionId, remoteJid: jid, isGroup: true, lastMessageAt, ...extras })
    .returning();
  await db.insert(s.messages).values({
    organizationId,
    conversationId: conversa.id,
    direction: "inbound",
    sender: "customer",
    body: "",
    messageType: "text",
    sentAt: lastMessageAt,
    createdAt: lastMessageAt,
    ...mensagem,
  });
  return conversa.id;
}

beforeAll(async () => {
  const [org] = await db
    .insert(s.organizations)
    .values({ name: "Grupos", slug: SUFFIX, publicId: SUFFIX, timezone: "America/Sao_Paulo" })
    .returning();
  organizationId = org.id;
  const [conn] = await db
    .insert(s.whatsappConnections)
    .values({
      organizationId,
      baseUrl: "https://invalido.test",
      instanceToken: "x",
      webhookToken: SUFFIX,
      phoneNumber: NOSSO_NUMERO,
    })
    .returning();
  connectionId = conn.id;
  ctx = { organizationId, timezone: "America/Sao_Paulo", role: "owner" } as unknown as TenantContext;

  // Quem fala nos grupos, traduzido — e um que ninguém sabe quem é.
  await db.insert(s.whatsappIdentities).values([
    { organizationId, jid: "111111111111@lid", phone: null, name: "Marcos Vinícius" },
    { organizationId, jid: `${NOSSO_NUMERO}@s.whatsapp.net`, phone: NOSSO_NUMERO, name: "Eu mesmo" },
  ]);

  // 1. Só o retrato do aparelho sabe deste. É o mais recente de todos.
  await criarGrupo("g-retrato@g.us", {
    name: "Só retrato",
    description: "Uma descrição que NÃO é mensagem",
    providerPreview: "Amanhã fecha",
    providerPreviewType: "Conversation",
    providerLastSender: "111111111111:12@lid",
    providerLastAt: emMinutos(5),
    providerUnread: 42,
  });

  // 2. Retrato e mensagem nossa; a nossa é mais recente e tem que vencer.
  await criarGrupo("g-local-vence@g.us", {
    name: "Local vence",
    providerPreview: "frase velha do retrato",
    providerPreviewType: "Conversation",
    providerLastSender: "111111111111@lid",
    providerLastAt: emMinutos(60),
    providerUnread: 7,
  });
  await criarConversaComMensagem(
    "g-local-vence@g.us",
    { body: "[imagem]", messageType: "image", direction: "outbound", sender: "user" },
    emMinutos(10),
  );

  // 3. Retrato de foto sem legenda, de remetente que ninguém conhece.
  await criarGrupo("g-foto@g.us", {
    name: "Foto sem legenda",
    providerPreview: null,
    providerPreviewType: "ImageMessage",
    providerLastSender: "999999999999@lid",
    providerLastAt: emMinutos(30),
    providerUnread: 3,
  });

  // 4. A última fala foi nossa, pelo celular: o retrato assina com o nosso número.
  await criarGrupo("g-nosso@g.us", {
    name: "Falamos por último",
    providerPreview: "combinado",
    providerPreviewType: "Conversation",
    providerLastSender: `${NOSSO_NUMERO}@s.whatsapp.net`,
    providerLastAt: emMinutos(90),
  });

  // 5. Conversa com histórico reconciliado HOJE: a linha de junho entrou no
  //    banco agora, depois da mensagem que é de verdade a mais recente.
  await criarGrupo("g-historico@g.us", { name: "Histórico antigo" });
  const conversaHistorico = await criarConversaComMensagem(
    "g-historico@g.us",
    { body: "a mais recente" },
    emMinutos(45),
  );
  await db.insert(s.messages).values({
    organizationId,
    conversationId: conversaHistorico,
    direction: "inbound",
    sender: "customer",
    body: "isto foi dito em junho",
    messageType: "text",
    sentAt: new Date("2026-06-08T14:19:58.000Z"),
    createdAt: new Date(),
  });

  // 6. Nada em lugar nenhum: o fundo da lista.
  await criarGrupo("g-vazio@g.us", { name: "Silencioso", description: "Grupo antigo da equipe" });

  // 7. Fixado e velho: fixado manda, e manda sobre a atividade recente.
  await criarGrupo("g-fixado@g.us", {
    name: "Fixado",
    pinned: true,
    classification: "opportunity",
    providerPreview: "isso foi ontem",
    providerPreviewType: "Conversation",
    providerLastAt: emMinutos(2000),
  });
});

afterAll(async () => {
  const convs = await db
    .select({ id: s.conversations.id })
    .from(s.conversations)
    .where(eq(s.conversations.organizationId, organizationId));
  for (const conv of convs) await db.delete(s.messages).where(eq(s.messages.conversationId, conv.id));
  await db.delete(s.conversations).where(eq(s.conversations.organizationId, organizationId));
  await db.delete(s.whatsappGroups).where(eq(s.whatsappGroups.organizationId, organizationId));
  await db.delete(s.whatsappIdentities).where(eq(s.whatsappIdentities.organizationId, organizationId));
  await db.delete(s.whatsappConnections).where(eq(s.whatsappConnections.id, connectionId));
  await db.delete(s.customers).where(eq(s.customers.organizationId, organizationId));
  await db.delete(s.organizations).where(eq(s.organizations.id, organizationId));
  await pool.end();
});

describe("prévia da lista", () => {
  it("mostra a frase quando é texto", () => {
    expect(montarPrevia("Conversation", "Bom dia")).toEqual({ preview: "Bom dia", kind: "text" });
  });

  it("troca o nome de protocolo por português quando não há legenda", () => {
    expect(montarPrevia("ImageMessage", null).preview).toBe("Foto");
    expect(montarPrevia("AudioMessage", null).preview).toBe("Áudio");
    expect(montarPrevia("PollUpdateMessage", null).preview).toBe("Voto em enquete");
    expect(montarPrevia("StickerMessage", "").preview).toBe("Figurinha");
  });

  it("prefere a legenda ao rótulo, como o WhatsApp", () => {
    const previa = montarPrevia("ImageMessage", "chegou hoje");
    expect(previa).toEqual({ preview: "chegou hoje", kind: "photo" });
  });

  it("transforma o emoji solto da reação em frase", () => {
    expect(montarPrevia("ReactionMessage", "❤️").preview).toBe("Reagiu com ❤️");
    expect(montarPrevia("ReactionMessage", null).preview).toBe("Reagiu à mensagem");
  });

  it("achata parágrafo em uma linha", () => {
    expect(montarPrevia("Conversation", "Bom dia\n\nTudo bem?").preview).toBe("Bom dia Tudo bem?");
  });

  it("não vaza o marcador interno de mídia", () => {
    expect(montarPreviaLocal("image", "[imagem]").preview).toBe("Foto");
    expect(montarPreviaLocal("audio", "[áudio]").preview).toBe("Áudio");
    expect(montarPreviaLocal("image", "olha isso").preview).toBe("olha isso");
  });

  it("tipo desconhecido não vira texto de protocolo na tela", () => {
    expect(montarPrevia("AlgoQueAindaNaoExiste", null).preview).toBeNull();
    expect(montarPrevia("AlgoQueAindaNaoExiste", "texto").preview).toBe("texto");
  });

  it("ignora o sufixo de dispositivo ao identificar quem falou", () => {
    expect(identidadeBase("111111111111:12@lid")).toBe("111111111111@lid");
    expect(identidadeBase("5584999990000@s.whatsapp.net")).toBe("5584999990000@s.whatsapp.net");
  });
});

describe("caixa de entrada de grupos", () => {
  it("ordena por atividade recente, com fixado no topo e mudo no fim", async () => {
    const pagina = await listGroupInbox(ctx, { limit: 30 });
    expect(pagina.items.map((g) => g.jid)).toEqual([
      "g-fixado@g.us",
      "g-retrato@g.us",
      "g-local-vence@g.us",
      "g-foto@g.us",
      "g-historico@g.us",
      "g-nosso@g.us",
      "g-vazio@g.us",
    ]);
    expect(pagina.total).toBe(7);
  });

  it("histórico reconciliado hoje não vira mensagem de agora", async () => {
    const pagina = await listGroupInbox(ctx, { limit: 30 });
    const grupo = pagina.items.find((g) => g.jid === "g-historico@g.us");
    // Ordenar pela hora de gravação escolheria a fala de junho e a anunciaria
    // como "agora"; a hora do WhatsApp escolhe a certa.
    expect(grupo?.lastMessagePreview).toBe("a mais recente");
    const idadeMin = (Date.now() - new Date(grupo!.lastMessageAt!).getTime()) / 60_000;
    expect(idadeMin).toBeGreaterThan(40);
    expect(idadeMin).toBeLessThan(50);
  });

  it("usa o retrato do aparelho e resolve o autor para nome", async () => {
    const pagina = await listGroupInbox(ctx, { limit: 30 });
    const grupo = pagina.items.find((g) => g.jid === "g-retrato@g.us");
    expect(grupo?.lastMessagePreview).toBe("Amanhã fecha");
    expect(grupo?.lastMessageSender).toBe("Marcos Vinícius");
    expect(grupo?.unreadCount).toBe(42);
  });

  it("nunca põe a descrição do grupo no lugar da última mensagem", async () => {
    const pagina = await listGroupInbox(ctx, { limit: 30 });
    const mudo = pagina.items.find((g) => g.jid === "g-vazio@g.us");
    expect(mudo?.description).toBe("Grupo antigo da equipe");
    expect(mudo?.lastMessagePreview).toBeNull();

    const comRetrato = pagina.items.find((g) => g.jid === "g-retrato@g.us");
    expect(comRetrato?.lastMessagePreview).not.toBe(comRetrato?.description);
  });

  it("mensagem nossa mais recente vence o retrato", async () => {
    const pagina = await listGroupInbox(ctx, { limit: 30 });
    const grupo = pagina.items.find((g) => g.jid === "g-local-vence@g.us");
    expect(grupo?.lastMessagePreview).toBe("Foto");
    expect(grupo?.lastMessageSender).toBe("Você");
    expect(grupo?.lastMessageFromMe).toBe(true);
  });

  it("sem nome para o autor, mostra a mensagem e nunca o número", async () => {
    const pagina = await listGroupInbox(ctx, { limit: 30 });
    const grupo = pagina.items.find((g) => g.jid === "g-foto@g.us");
    expect(grupo?.lastMessageSender).toBeNull();
    expect(grupo?.lastMessagePreview).toBe("Foto");
    expect(grupo?.lastMessageKind).toBe("photo");
  });

  it("reconhece a nossa própria voz no retrato", async () => {
    const pagina = await listGroupInbox(ctx, { limit: 30 });
    const grupo = pagina.items.find((g) => g.jid === "g-nosso@g.us");
    expect(grupo?.lastMessageSender).toBe("Você");
    expect(grupo?.lastMessageFromMe).toBe(true);
    expect(grupo?.awaitingReply).toBe(false);
  });

  it("filtra por gaveta e conta cada uma", async () => {
    const pagina = await listGroupInbox(ctx, { classification: "opportunity", limit: 30 });
    expect(pagina.items.map((g) => g.jid)).toEqual(["g-fixado@g.us"]);
    expect(pagina.total).toBe(1);
    expect(pagina.counts.all).toBe(7);
    expect(pagina.counts.opportunity).toBe(1);
    expect(pagina.counts.none).toBe(6);
  });

  it("busca pelo nome do grupo, e não pela descrição", async () => {
    const pagina = await listGroupInbox(ctx, { search: "Silencioso", limit: 30 });
    expect(pagina.items.map((g) => g.jid)).toEqual(["g-vazio@g.us"]);

    // "Grupo antigo da equipe" é a descrição de g-vazio: casar por ela traria
    // um resultado que quem buscou não consegue explicar olhando a lista.
    const porDescricao = await listGroupInbox(ctx, { search: "antigo da equipe", limit: 30 });
    expect(porDescricao.items).toHaveLength(0);
  });

  it("trata curinga digitado na busca como texto", async () => {
    const pagina = await listGroupInbox(ctx, { search: "%", limit: 30 });
    expect(pagina.items).toHaveLength(0);
  });
});

describe("fio do grupo", () => {
  it("carimba a bolha com a hora do WhatsApp, não a da importação", async () => {
    const fio = await getGroupThread(ctx, "g-historico@g.us");
    const corpos = fio.messages.map((m) => m.body);
    // Ordem cronológica de verdade: junho antes da fala de 45 minutos atrás.
    expect(corpos).toEqual(["isto foi dito em junho", "a mais recente"]);
    expect(fio.messages[0].createdAt.toISOString()).toBe("2026-06-08T14:19:58.000Z");
  });
});

/**
 * Nome de participante.
 *
 * O `/group/info` devolve `DisplayName` vazio para todo mundo — no aplicativo
 * os nomes saem da agenda do aparelho, que não é nossa. Sem isto a aba Membros
 * era uma coluna de telefones.
 */
describe("nomes dos membros do grupo", () => {
  const FONE_CLIENTE = "5584981112222";
  const FONE_CONHECIDO = "5584933334444";
  const LID = "999888777@lid";

  beforeAll(async () => {
    await db.insert(s.customers).values({
      organizationId,
      name: "Dona Marlene",
      phone: FONE_CLIENTE,
    });
    await db.insert(s.whatsappIdentities).values([
      { organizationId, jid: `${FONE_CLIENTE}@s.whatsapp.net`, phone: FONE_CLIENTE, name: "marlene 💅" },
      { organizationId, jid: `${FONE_CONHECIDO}@s.whatsapp.net`, phone: FONE_CONHECIDO, name: "Seu Zé" },
      { organizationId, jid: LID, phone: null, name: "Tia Neide" },
    ]);
  });

  it("usa a ficha da clínica na frente do nome do WhatsApp", async () => {
    // As duas fontes conhecem esse telefone. Vence o nome que a atendente
    // escreveu na ficha: é assim que ela chama a pessoa.
    const [pessoa] = await nomearParticipantes(organizationId, [
      { jid: `${FONE_CLIENTE}@s.whatsapp.net`, phone: FONE_CLIENTE, displayName: null, isAdmin: false, isSuperAdmin: false },
    ]);
    expect(pessoa.displayName).toBe("Dona Marlene");
  });

  it("cai no nome do WhatsApp quando não é cliente da casa", async () => {
    const [pessoa] = await nomearParticipantes(organizationId, [
      { jid: `${FONE_CONHECIDO}@s.whatsapp.net`, phone: FONE_CONHECIDO, displayName: null, isAdmin: false, isSuperAdmin: false },
    ]);
    expect(pessoa.displayName).toBe("Seu Zé");
  });

  it("reconhece quem só aparece por identificador interno", async () => {
    // Em grupo o WhatsApp assina com `@lid`, sem telefone nenhum.
    const [pessoa] = await nomearParticipantes(organizationId, [
      { jid: LID, phone: null, displayName: null, isAdmin: false, isSuperAdmin: false },
    ]);
    expect(pessoa.displayName).toBe("Tia Neide");
  });

  it("deixa quem não conhecemos sem nome, para a tela mostrar o telefone", async () => {
    // Nunca inventar: sem nome a tela imprime o telefone formatado, jamais o
    // identificador interno.
    const [pessoa] = await nomearParticipantes(organizationId, [
      { jid: "111222333@lid", phone: "5584955556666", displayName: null, isAdmin: false, isSuperAdmin: false },
    ]);
    expect(pessoa.displayName).toBeNull();
  });

  it("encontra a pessoa mesmo com e sem o nono dígito", async () => {
    // O provedor entrega o mesmo aparelho ora com 12 dígitos, ora com 13:
    // nesta base são 2.239 de um jeito e 678 do outro. Comparar texto com
    // texto fazia da mesma pessoa duas — e a que tinha nome nunca aparecia.
    // Forma antiga do MESMO aparelho: sem o nono dígito.
    const semNono = "558481112222";
    const [pessoa] = await nomearParticipantes(organizationId, [
      { jid: "555444333@lid", phone: semNono, displayName: null, isAdmin: false, isSuperAdmin: false },
    ]);
    expect(pessoa.displayName).toBe("Dona Marlene");
  });

  it("não toca em quem já veio com nome do provedor", async () => {
    const [pessoa] = await nomearParticipantes(organizationId, [
      { jid: `${FONE_CLIENTE}@s.whatsapp.net`, phone: FONE_CLIENTE, displayName: "Nome do aparelho", isAdmin: false, isSuperAdmin: false },
    ]);
    expect(pessoa.displayName).toBe("Nome do aparelho");
  });

  it("não vaza nome de outra conta", async () => {
    const vizinha = await db
      .insert(s.organizations)
      .values({ publicId: generateAccountCode(), name: `Vizinha ${SUFFIX}`, slug: `vizinha-${SUFFIX}` })
      .returning({ id: s.organizations.id });
    const [pessoa] = await nomearParticipantes(vizinha[0].id, [
      { jid: `${FONE_CLIENTE}@s.whatsapp.net`, phone: FONE_CLIENTE, displayName: null, isAdmin: false, isSuperAdmin: false },
    ]);
    expect(pessoa.displayName).toBeNull();
    await db.delete(s.organizations).where(eq(s.organizations.id, vizinha[0].id));
  });
});
