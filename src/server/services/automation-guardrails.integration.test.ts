import { randomBytes } from "node:crypto";
import { addDays, addMinutes } from "date-fns";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pool } from "@/db";
import * as s from "@/db/schema";
import { generateAccountCode } from "@/lib/account-code";
import type { TenantContext } from "@/server/auth";

/**
 * As travas que impedem a automação de queimar o número da clínica, contra o
 * Postgres real e com a uazapi simulada.
 *
 * Tudo aqui roda numa conta criada e apagada pelo próprio teste, e a varredura
 * é chamada com `organizationId` justamente para não encostar nas contas de
 * verdade que dividem este banco. NENHUMA mensagem sai: o cliente da uazapi é
 * substituído por dublês antes do import do serviço.
 *
 * O que está protegido:
 *  - a rajada (teto por ciclo, teto por hora e cadência entre envios);
 *  - a segunda regra ativa no mesmo gatilho, que triplicou o lembrete real;
 *  - o lembrete com horário ERRADO depois de a cliente remarcar;
 *  - o corte cego da varredura, que perdia lembretes aleatoriamente;
 *  - o "sentimos sua falta" para quem já tem horário marcado;
 *  - o disparo que falha e morre em silêncio, sem retentativa e sem tela.
 */

const uazapi = vi.hoisted(() => ({
  checkNumbers: vi.fn(),
  sendText: vi.fn(),
  markChatRead: vi.fn(),
}));

vi.mock("@/server/whatsapp/uazapi-client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/whatsapp/uazapi-client")>();
  return { ...real, ...uazapi };
});

const { UazapiError } = await import("@/server/whatsapp/uazapi-client");
const {
  AutomationRuleConflictError,
  MAX_AUTOMACOES_POR_CICLO,
  MAX_AUTOMACOES_POR_HORA,
  PAUSA_MAX_MS,
  PAUSA_MIN_MS,
  _internals,
  automationDedupeKey,
  automationScheduledFor,
  createAutomationRule,
  dispatchDueAutomations,
  listRecentDispatches,
  setAutomationRuleActive,
} = await import("./automation-service");

const SUFFIX = `vitest-automacoes-${randomBytes(4).toString("hex")}`;
const TZ = "America/Sao_Paulo";

let ctx: TenantContext;
let organizationId: number;
let userId: number;
let branchId: number;
let professionalId: number;
let serviceId: number;

/** Celular plausível e único por índice, para o cadastro não colidir. */
function telefone(indice: number): string {
  return `55119${String(80000000 + indice).padStart(8, "0")}`;
}

async function criarCliente(indice: number, extra: Partial<typeof s.customers.$inferInsert> = {}) {
  const [cliente] = await db
    .insert(s.customers)
    .values({ organizationId, name: `Cliente ${indice}`, phone: telefone(indice), ...extra })
    .returning();
  return cliente;
}

async function criarAgendamento(
  customerId: number,
  startsAt: Date,
  status: "scheduled" | "confirmed" | "completed" = "scheduled",
) {
  const [agendamento] = await db
    .insert(s.appointments)
    .values({
      organizationId,
      branchId,
      customerId,
      professionalId,
      serviceId,
      startsAt,
      endsAt: addMinutes(startsAt, 30),
      status,
      priceCents: 10000,
    })
    .returning();
  return agendamento;
}

async function criarRegra(input: {
  trigger: (typeof s.automationRules.$inferInsert)["trigger"];
  daysOffset?: number;
  sendTime?: string;
  active?: boolean;
  name?: string;
}) {
  const [regra] = await db
    .insert(s.automationRules)
    .values({
      organizationId,
      name: input.name ?? "Regra de teste",
      trigger: input.trigger,
      daysOffset: input.daysOffset ?? 0,
      sendTime: input.sendTime ?? "09:00",
      messageTemplate: "Oi, {nome}! Seu horário é dia {data} às {hora}.",
      active: input.active ?? true,
    })
    .returning();
  return regra;
}

async function disparos() {
  return db
    .select()
    .from(s.automationDispatches)
    .where(eq(s.automationDispatches.organizationId, organizationId))
    .orderBy(asc(s.automationDispatches.id));
}

async function limparEntreCasos() {
  await db.delete(s.automationDispatches).where(eq(s.automationDispatches.organizationId, organizationId));
  await db.delete(s.messages).where(eq(s.messages.organizationId, organizationId));
  await db.delete(s.conversations).where(eq(s.conversations.organizationId, organizationId));
  await db.delete(s.appointments).where(eq(s.appointments.organizationId, organizationId));
  await db.delete(s.automationRules).where(eq(s.automationRules.organizationId, organizationId));
}

/**
 * Horário do atendimento e instante em que o lembrete dele vence.
 *
 * A varredura recebe o `agora` calculado, e não o relógio da máquina: um teste
 * que dependesse da hora em que roda passaria de manhã e falharia de tarde.
 */
function atendimentoEVencimento(daquiAHoras: number, daysOffset = 1, sendTime = "09:00") {
  const eventAt = new Date(Date.now() + daquiAHoras * 3_600_000);
  eventAt.setUTCSeconds(0, 0);
  const due = automationScheduledFor(eventAt, "before_appointment", daysOffset, sendTime, TZ);
  return { eventAt, agora: new Date(due.getTime() + 60_000) };
}

beforeAll(async () => {
  const [org] = await db
    .insert(s.organizations)
    .values({ publicId: generateAccountCode(), name: "Salão de teste", slug: SUFFIX, timezone: TZ })
    .returning();
  organizationId = org.id;

  const [user] = await db
    .insert(s.users)
    .values({ name: "Dona", email: `${SUFFIX}@example.test`, passwordHash: "x" })
    .returning();
  userId = user.id;
  await db.insert(s.organizationMembers).values({ organizationId, userId, role: "owner" });

  await db.insert(s.whatsappConnections).values({
    organizationId,
    baseUrl: "https://invalido.test",
    instanceToken: "x",
    webhookToken: SUFFIX,
    status: "connected",
  });

  const [branch] = await db.insert(s.branches).values({ organizationId, name: "Unidade" }).returning();
  branchId = branch.id;
  const [profissional] = await db
    .insert(s.professionals)
    .values({ organizationId, name: "Manicure", commissionBps: 3000 })
    .returning();
  professionalId = profissional.id;
  const [servico] = await db
    .insert(s.services)
    .values({ organizationId, name: "Manutenção", durationMin: 60, priceCents: 10000 })
    .returning();
  serviceId = servico.id;

  ctx = {
    organizationId,
    organizationName: "Salão de teste",
    organizationSlug: SUFFIX,
    organizationCode: "TEST-0000",
    timezone: TZ,
    userId,
    userName: "Dona",
    userEmail: `${SUFFIX}@example.test`,
    role: "owner",
  };
}, 60_000);

beforeEach(() => {
  uazapi.markChatRead.mockResolvedValue(undefined);
  uazapi.checkNumbers.mockImplementation(async (_cred: unknown, numeros: string[]) =>
    numeros.map((numero) => ({ query: numero, exists: true, jid: `${numero}@s.whatsapp.net` })),
  );
  uazapi.sendText.mockResolvedValue({ messageId: `ext-${randomBytes(6).toString("hex")}` });
});

afterEach(async () => {
  vi.clearAllMocks();
  await limparEntreCasos();
});

afterAll(async () => {
  await db.delete(s.automationDispatches).where(eq(s.automationDispatches.organizationId, organizationId));
  await db.delete(s.automationRules).where(eq(s.automationRules.organizationId, organizationId));
  await db.delete(s.messages).where(eq(s.messages.organizationId, organizationId));
  await db.delete(s.conversations).where(eq(s.conversations.organizationId, organizationId));
  await db.delete(s.appointments).where(eq(s.appointments.organizationId, organizationId));
  await db.delete(s.services).where(eq(s.services.organizationId, organizationId));
  await db.delete(s.professionals).where(eq(s.professionals.organizationId, organizationId));
  await db.delete(s.customers).where(eq(s.customers.organizationId, organizationId));
  await db.delete(s.whatsappConnections).where(eq(s.whatsappConnections.organizationId, organizationId));
  await db.delete(s.branches).where(eq(s.branches.organizationId, organizationId));
  await db.delete(s.organizationMembers).where(eq(s.organizationMembers.organizationId, organizationId));
  await db.delete(s.users).where(eq(s.users.id, userId));
  await db.delete(s.organizations).where(eq(s.organizations.id, organizationId));
  await pool.end();
});

// ---------------------------------------------------------------------------

describe("A3 — regra duplicada no mesmo gatilho", () => {
  it("recusa a segunda automação ativa com explicação em português", async () => {
    await criarRegra({ trigger: "before_appointment", daysOffset: 1, name: "Lembrete para evitar faltas" });

    await expect(
      createAutomationRule(ctx, {
        name: "Lembrete de novo",
        trigger: "before_appointment",
        daysOffset: 1,
        sendTime: "09:00",
        messageTemplate: "Oi, {nome}!",
        active: true,
      }),
    ).rejects.toBeInstanceOf(AutomationRuleConflictError);

    const regras = await db
      .select()
      .from(s.automationRules)
      .where(eq(s.automationRules.organizationId, organizationId));
    expect(regras).toHaveLength(1);
  });

  it("explica qual automação já ocupa o gatilho", async () => {
    await criarRegra({ trigger: "birthday_day", name: "Feliz aniversário" });
    await expect(
      createAutomationRule(ctx, {
        name: "Outra de aniversário",
        trigger: "birthday_day",
        daysOffset: 0,
        sendTime: "09:00",
        messageTemplate: "Parabéns, {nome}!",
        active: true,
      }),
    ).rejects.toThrow(/Feliz aniversário/);
  });

  it("recusa ATIVAR uma regra pausada quando outra já ocupa o gatilho", async () => {
    await criarRegra({ trigger: "appointment_day", name: "No dia" });
    const pausada = await criarRegra({ trigger: "appointment_day", name: "No dia (cópia)", active: false });
    await expect(setAutomationRuleActive(ctx, pausada.id, true)).rejects.toBeInstanceOf(
      AutomationRuleConflictError,
    );
  });

  it("permite regras ativas em gatilhos diferentes", async () => {
    await criarRegra({ trigger: "before_appointment", daysOffset: 1 });
    await createAutomationRule(ctx, {
      name: "No dia",
      trigger: "appointment_day",
      daysOffset: 0,
      sendTime: "08:00",
      messageTemplate: "Bom dia, {nome}!",
      active: true,
    });
    const regras = await db
      .select()
      .from(s.automationRules)
      .where(eq(s.automationRules.organizationId, organizationId));
    expect(regras).toHaveLength(2);
  });

  it("o banco recusa a corrida, e o serviço reconhece essa recusa", async () => {
    await criarRegra({ trigger: "after_appointment", daysOffset: 21 });
    // Insert direto, sem passar pelo serviço: é o que dois cliques simultâneos
    // fariam depois de os dois SELECTs terem devolvido "livre".
    const erro = await criarRegra({ trigger: "after_appointment", daysOffset: 21 }).catch((e) => e);
    expect(erro).toBeInstanceOf(Error);
    // O erro que chega ao serviço é o do driver ("Failed query: ..."): o nome da
    // restrição só existe dentro do `cause`. Testado contra o erro REAL porque
    // é aqui que a tradução para português se perderia em silêncio.
    expect(erro.message).not.toContain("automation_rules_active_trigger_unique");
    expect(_internals.ehConflitoDeGatilho(erro)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("A5 — remarcar o horário", () => {
  it("a chave de dedupe carrega o dia do atendimento, não só o agendamento", () => {
    const terca = new Date("2026-09-08T17:00:00.000Z");
    const quinta = new Date("2026-09-10T17:00:00.000Z");
    const base = { sourceType: "appointment" };
    expect(automationDedupeKey("before_appointment", { ...base, eventAt: terca }, TZ)).toBe(
      "appointment:2026-09-08",
    );
    expect(automationDedupeKey("before_appointment", { ...base, eventAt: quinta }, TZ)).toBe(
      "appointment:2026-09-10",
    );
    // Ancorados em fato passado continuam com a chave simples.
    expect(automationDedupeKey("after_appointment", { ...base, eventAt: terca }, TZ)).toBe("appointment");
  });

  it("gera lembrete novo com o horário novo depois da remarcação", async () => {
    const regra = await criarRegra({ trigger: "before_appointment", daysOffset: 1, sendTime: "09:00" });
    const cliente = await criarCliente(1);
    const primeiroHorario = atendimentoEVencimento(30);
    const agendamento = await criarAgendamento(cliente.id, primeiroHorario.eventAt);

    await dispatchDueAutomations(primeiroHorario.agora, { organizationId, sleep: async () => {} });
    const primeiro = await disparos();
    expect(primeiro).toHaveLength(1);
    expect(primeiro[0].status).toBe("sent");

    // A cliente remarca para o dia seguinte.
    const novoHorario = atendimentoEVencimento(54);
    await db
      .update(s.appointments)
      .set({ startsAt: novoHorario.eventAt, endsAt: addMinutes(novoHorario.eventAt, 30) })
      .where(eq(s.appointments.id, agendamento.id));

    await dispatchDueAutomations(novoHorario.agora, { organizationId, sleep: async () => {} });
    const depoisDeRemarcar = await disparos();
    // ANTES: a chave `appointment:{id}` já constava como enviada e nenhum
    // lembrete novo nascia — a cliente ficava com o aviso do horário errado.
    expect(depoisDeRemarcar).toHaveLength(2);
    expect(depoisDeRemarcar[1].sourceType).not.toBe(depoisDeRemarcar[0].sourceType);
    expect(depoisDeRemarcar[1].ruleId).toBe(regra.id);
    expect(depoisDeRemarcar[1].message).not.toBe(depoisDeRemarcar[0].message);
  });
});

// ---------------------------------------------------------------------------

describe("A5b — ponte com a chave antiga", () => {
  it("não repete o lembrete que a versão anterior já enviou", async () => {
    const regra = await criarRegra({ trigger: "before_appointment", daysOffset: 1, sendTime: "09:00" });
    const cliente = await criarCliente(50);
    const { eventAt, agora } = atendimentoEVencimento(30);
    const agendamento = await criarAgendamento(cliente.id, eventAt);
    const due = automationScheduledFor(eventAt, "before_appointment", 1, "09:00", TZ);

    // Linha escrita pela versão ANTIGA: chave `appointment` sem data. Foi
    // exatamente esta divergência que fez uma cliente real receber o mesmo
    // lembrete duas vezes durante a virada de versão.
    await db.insert(s.automationDispatches).values({
      organizationId,
      ruleId: regra.id,
      customerId: cliente.id,
      sourceType: "appointment",
      sourceId: agendamento.id,
      scheduledFor: due,
      lastAttemptAt: due,
      sentAt: due,
      status: "sent",
      message: "Lembrete que já saiu",
    });

    const resultado = await dispatchDueAutomations(agora, { organizationId, sleep: async () => {} });
    expect(resultado.sent).toBe(0);
    expect(uazapi.sendText).not.toHaveBeenCalled();
    expect(await disparos()).toHaveLength(1);
  });

  it("mas a ponte não cobre outra ocorrência do mesmo agendamento", async () => {
    const regra = await criarRegra({ trigger: "before_appointment", daysOffset: 1, sendTime: "09:00" });
    const cliente = await criarCliente(51);
    const { eventAt, agora } = atendimentoEVencimento(30);
    const agendamento = await criarAgendamento(cliente.id, eventAt);

    // Linha antiga de OUTRO dia: remarcar continua gerando lembrete novo.
    await db.insert(s.automationDispatches).values({
      organizationId,
      ruleId: regra.id,
      customerId: cliente.id,
      sourceType: "appointment",
      sourceId: agendamento.id,
      scheduledFor: new Date(agora.getTime() - 5 * 86_400_000),
      lastAttemptAt: new Date(agora.getTime() - 5 * 86_400_000),
      status: "sent",
      message: "Lembrete de uma marcação anterior",
    });

    const resultado = await dispatchDueAutomations(agora, { organizationId, sleep: async () => {} });
    expect(resultado.sent).toBe(1);
  });
});

describe("A6 — varredura completa", () => {
  it("enxerga além das primeiras 500 linhas", async () => {
    const cliente = await criarCliente(2);
    // 520 atendimentos, um por hora, em dias seguidos: passa do corte antigo
    // de 500 e nenhum colide com outro.
    const base = addDays(new Date(), 2);
    base.setUTCHours(11, 0, 0, 0);
    const linhas = Array.from({ length: 520 }, (_, i) => {
      const startsAt = addMinutes(addDays(base, Math.floor(i / 10)), (i % 10) * 60);
      return {
        organizationId,
        branchId,
        customerId: cliente.id,
        professionalId,
        serviceId,
        startsAt,
        endsAt: addMinutes(startsAt, 30),
        status: "scheduled" as const,
        priceCents: 10000,
      };
    });
    await db.insert(s.appointments).values(linhas);

    const regra = await criarRegra({ trigger: "before_appointment", daysOffset: 1 });
    const candidatos = await _internals.candidatesForRule(regra, new Date(), TZ);
    // ANTES: `.limit(500)` sem `orderBy` — 500 linhas quaisquer, conjunto
    // diferente a cada varredura, lembretes perdidos sem rastro.
    expect(candidatos.length).toBe(520);
    const denovo = await _internals.candidatesForRule(regra, new Date(), TZ);
    expect(denovo.map((c) => c.sourceId)).toEqual(candidatos.map((c) => c.sourceId));
  }, 60_000);

  it("não manda “sentimos sua falta” para quem já tem horário marcado", async () => {
    const semRetorno = await criarCliente(3, { consentMarketing: true });
    const comRetorno = await criarCliente(4, { consentMarketing: true });
    const ontem = addDays(new Date(), -30);
    ontem.setUTCHours(13, 0, 0, 0);
    await criarAgendamento(semRetorno.id, ontem, "completed");
    await criarAgendamento(comRetorno.id, addMinutes(ontem, 120), "completed");
    // Só esta tem hora marcada para a semana que vem.
    await criarAgendamento(comRetorno.id, addDays(new Date(), 7), "confirmed");

    const regra = await criarRegra({ trigger: "after_appointment", daysOffset: 21 });
    const candidatos = await _internals.candidatesForRule(regra, new Date(), TZ);
    const ids = candidatos.map((c) => c.customerId);
    expect(ids).toContain(semRetorno.id);
    // ANTES: recebia "sentimos sua falta" com o horário dela já marcado.
    expect(ids).not.toContain(comRetorno.id);
  });
});

// ---------------------------------------------------------------------------

describe("A2 — teto anti-bloqueio e cadência", () => {
  it("segura a rajada, espaça os envios e conta a conversa aberta pela automação", async () => {
    await criarRegra({ trigger: "before_appointment", daysOffset: 1, sendTime: "09:00" });
    const { eventAt, agora } = atendimentoEVencimento(30);
    // Doze clientes com horário no mesmo dia: é a forma da rajada real (uma
    // regra vencendo para a agenda inteira de amanhã de uma vez).
    for (let i = 0; i < 12; i += 1) {
      const cliente = await criarCliente(100 + i);
      await criarAgendamento(cliente.id, addMinutes(eventAt, i * 45));
    }

    const pausas: number[] = [];
    const resultado = await dispatchDueAutomations(agora, {
      organizationId,
      sleep: async (ms) => {
        pausas.push(ms);
      },
    });

    // ANTES: as 12 saíam de uma vez, sem pausa nenhuma.
    expect(resultado.sent).toBe(MAX_AUTOMACOES_POR_CICLO);
    expect(resultado.postponed).toBe(12 - MAX_AUTOMACOES_POR_CICLO);
    expect(uazapi.sendText).toHaveBeenCalledTimes(MAX_AUTOMACOES_POR_CICLO);

    // Uma pausa entre cada par: a primeira mensagem do ciclo não espera.
    expect(pausas).toHaveLength(MAX_AUTOMACOES_POR_CICLO - 1);
    for (const pausa of pausas) {
      expect(pausa).toBeGreaterThanOrEqual(PAUSA_MIN_MS);
      expect(pausa).toBeLessThanOrEqual(PAUSA_MAX_MS);
    }

    // O que foi segurado não deixou linha reservada para trás: nada em
    // "processing" para a varredura seguinte ter de destravar.
    const registros = await disparos();
    expect(registros).toHaveLength(MAX_AUTOMACOES_POR_CICLO);
    expect(registros.every((d) => d.status === "sent")).toBe(true);

    // O teto de conversas novas só funciona se ele ENXERGAR a automação.
    const conversas = await db
      .select({ startedBy: s.conversations.startedBy, startedByUserId: s.conversations.startedByUserId })
      .from(s.conversations)
      .where(eq(s.conversations.organizationId, organizationId));
    expect(conversas).toHaveLength(MAX_AUTOMACOES_POR_CICLO);
    expect(conversas.every((c) => c.startedBy === "automation")).toBe(true);
    // ANTES: a contagem era por este campo, que o envio automático nunca
    // preenchia — o teto marcava zero enquanto a rajada acontecia.
    expect(conversas.every((c) => c.startedByUserId === null)).toBe(true);
  }, 60_000);
});

// ---------------------------------------------------------------------------

describe("A4 — falha visível e retentativa", () => {
  it("grava o erro do provedor e retenta o MESMO registro depois do recuo", async () => {
    await criarRegra({ trigger: "before_appointment", daysOffset: 1, sendTime: "09:00" });
    const cliente = await criarCliente(200);
    const { eventAt, agora } = atendimentoEVencimento(30);
    await criarAgendamento(cliente.id, eventAt);

    uazapi.sendText.mockRejectedValueOnce(new UazapiError("Bad Gateway", 502, '{"error":"upstream down"}'));
    await dispatchDueAutomations(agora, { organizationId, sleep: async () => {} });

    const [falho] = await disparos();
    expect(falho.status).toBe("failed");
    expect(falho.attempts).toBe(1);
    expect(falho.errorCode).toBe("ENVIO_FALHOU");
    // ANTES: aqui ficava só o texto de interface, e o motivo real do provedor
    // não era guardado em lugar nenhum.
    expect(falho.errorDetail).toContain("502");
    expect(falho.errorDetail).toContain("upstream down");
    expect(falho.error).toMatch(/Tente de novo/);

    // O recuo ainda não venceu: a varredura seguinte não pode insistir.
    await dispatchDueAutomations(agora, { organizationId, sleep: async () => {} });
    expect(uazapi.sendText).toHaveBeenCalledTimes(1);

    // Envelhece a tentativa para além do recuo de 5 minutos.
    await db
      .update(s.automationDispatches)
      .set({ lastAttemptAt: new Date(agora.getTime() - 30 * 60_000) })
      .where(eq(s.automationDispatches.id, falho.id));

    const resultado = await dispatchDueAutomations(agora, { organizationId, sleep: async () => {} });
    expect(resultado.retried).toBe(1);

    const depois = await disparos();
    // UPDATE no registro que existe, e NÃO uma linha nova — o índice único
    // recusaria a linha nova, que foi por onde a falha morria.
    expect(depois).toHaveLength(1);
    expect(depois[0].id).toBe(falho.id);
    expect(depois[0].status).toBe("sent");
    expect(depois[0].attempts).toBe(2);
    expect(depois[0].errorDetail).toBeNull();
  }, 60_000);

  it("destrava o claim órfão que ficou preso entre a reserva e o envio", async () => {
    const regra = await criarRegra({ trigger: "before_appointment", daysOffset: 1 });
    const cliente = await criarCliente(201);
    // Sem agendamento nenhum: o que está sob teste é a retomada do registro
    // reservado, não a varredura de candidatos.
    // Reserva feita, processo morto antes do envio: sem a varredura de órfãos,
    // esta linha fica "em andamento" para sempre e o índice único impede
    // qualquer outro ciclo de reservá-la de novo.
    const [orfao] = await db
      .insert(s.automationDispatches)
      .values({
        organizationId,
        ruleId: regra.id,
        customerId: cliente.id,
        sourceType: "appointment:2999-01-01",
        sourceId: 999_000_001,
        scheduledFor: new Date(Date.now() - 60_000),
        lastAttemptAt: new Date(Date.now() - 60 * 60_000),
        message: "Oi!",
        status: "processing",
      })
      .returning();

    const resultado = await dispatchDueAutomations(new Date(), { organizationId, sleep: async () => {} });
    expect(resultado.retried).toBe(1);
    const [depois] = await db
      .select()
      .from(s.automationDispatches)
      .where(eq(s.automationDispatches.id, orfao.id));
    expect(depois.status).toBe("sent");
    expect(depois.attempts).toBe(2);
  });

  it("NUNCA retenta o envio que o provedor já aceitou", async () => {
    const regra = await criarRegra({ trigger: "before_appointment", daysOffset: 1 });
    const cliente = await criarCliente(202);
    // A cliente JÁ recebeu; a falha veio depois do envio. Insistir aqui é
    // mandar a mesma mensagem duas vezes — o defeito original.
    await db.insert(s.automationDispatches).values({
      organizationId,
      ruleId: regra.id,
      customerId: cliente.id,
      sourceType: "appointment:2999-02-02",
      sourceId: 999_000_002,
      scheduledFor: new Date(Date.now() - 60_000),
      lastAttemptAt: new Date(Date.now() - 6 * 60 * 60_000),
      message: "Oi!",
      status: "failed",
      errorCode: "ENVIO_INCERTO",
      error: "A mensagem foi aceita pelo WhatsApp, mas algo falhou logo depois.",
    });

    const resultado = await dispatchDueAutomations(new Date(), { organizationId, sleep: async () => {} });
    expect(resultado.retried).toBe(0);
    expect(uazapi.sendText).not.toHaveBeenCalled();
  });

  it("desiste do disparo que perdeu a validade, com motivo escrito", async () => {
    const regra = await criarRegra({ trigger: "before_appointment", daysOffset: 1 });
    const cliente = await criarCliente(203);
    await db.insert(s.automationDispatches).values({
      organizationId,
      ruleId: regra.id,
      customerId: cliente.id,
      sourceType: "appointment:2999-03-03",
      sourceId: 999_000_003,
      scheduledFor: new Date(Date.now() - 20 * 60 * 60_000),
      lastAttemptAt: new Date(Date.now() - 20 * 60 * 60_000),
      message: "Oi!",
      status: "processing",
    });

    const resultado = await dispatchDueAutomations(new Date(), { organizationId, sleep: async () => {} });
    expect(resultado.expired).toBe(1);
    expect(uazapi.sendText).not.toHaveBeenCalled();

    const [linha] = await disparos();
    expect(linha.status).toBe("failed");
    expect(linha.errorCode).toBe("EXPIRADO");
    expect(linha.error).toMatch(/validade/);
  });

  it("a tela de disparos mostra cliente, regra e motivo da falha", async () => {
    const regra = await criarRegra({ trigger: "before_appointment", daysOffset: 1, name: "Lembrete de véspera" });
    const cliente = await criarCliente(204, { name: "Joana Prado" });
    await db.insert(s.automationDispatches).values({
      organizationId,
      ruleId: regra.id,
      customerId: cliente.id,
      sourceType: "appointment:2999-04-04",
      sourceId: 999_000_004,
      scheduledFor: new Date(),
      lastAttemptAt: new Date(),
      message: "Oi!",
      status: "failed",
      error: "Esse número não tem WhatsApp.",
      errorCode: "SEM_WHATSAPP",
      errorDetail: "UazapiError 404: not found",
    });

    const linhas = await listRecentDispatches(ctx);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      customerName: "Joana Prado",
      ruleName: "Lembrete de véspera",
      status: "failed",
      error: "Esse número não tem WhatsApp.",
      errorDetail: "UazapiError 404: not found",
    });
  });

  it("não vaza disparo de outra conta para a tela", async () => {
    const [outra] = await db
      .insert(s.organizations)
      .values({ publicId: generateAccountCode(), name: "Outra", slug: `${SUFFIX}-outra`, timezone: TZ })
      .returning();
    const regra = await criarRegra({ trigger: "before_appointment", daysOffset: 1 });
    const cliente = await criarCliente(205);
    await db.insert(s.automationDispatches).values({
      organizationId: outra.id,
      ruleId: regra.id,
      customerId: cliente.id,
      sourceType: "appointment:2999-05-05",
      sourceId: 999_000_005,
      scheduledFor: new Date(),
      lastAttemptAt: new Date(),
      message: "Oi!",
    });

    expect(await listRecentDispatches(ctx)).toHaveLength(0);

    await db.delete(s.automationDispatches).where(eq(s.automationDispatches.organizationId, outra.id));
    await db.delete(s.organizations).where(eq(s.organizations.id, outra.id));
  });
});

// ---------------------------------------------------------------------------

describe("A2b — o teto por hora tem de enxergar a retentativa", () => {
  it("não deixa a retomada de uma fila de falhas passar por cima do teto da hora", async () => {
    const regra = await criarRegra({ trigger: "before_appointment", daysOffset: 1, sendTime: "09:00" });
    const cliente = await criarCliente(400);
    const { eventAt, agora } = atendimentoEVencimento(30);
    await criarAgendamento(cliente.id, eventAt);

    /**
     * Sessenta mensagens que SAÍRAM na última hora, em linhas abertas há duas.
     *
     * É a forma exata da retomada depois de o provedor voltar do ar: o reenvio
     * é um UPDATE no registro que já existe, então a data de CRIAÇÃO da linha
     * não anda. Contar por ela faz o teto ler zero enquanto a conta despeja
     * uma rajada — o furo que o teto existe para fechar.
     */
    const duasHoras = new Date(agora.getTime() - 2 * 3_600_000);
    const dezMinutos = new Date(agora.getTime() - 10 * 60_000);
    await db.insert(s.automationDispatches).values(
      Array.from({ length: MAX_AUTOMACOES_POR_HORA }, (_, i) => ({
        organizationId,
        ruleId: regra.id,
        customerId: cliente.id,
        sourceType: `appointment:2999-06-${String(i + 1).padStart(2, "0")}`,
        sourceId: 998_000_000 + i,
        scheduledFor: duasHoras,
        createdAt: duasHoras,
        lastAttemptAt: dezMinutos,
        sentAt: dezMinutos,
        status: "sent" as const,
        message: "Já saiu",
      })),
    );

    const resultado = await dispatchDueAutomations(agora, { organizationId, sleep: async () => {} });
    expect(uazapi.sendText).not.toHaveBeenCalled();
    expect(resultado.sent).toBe(0);
    expect(resultado.postponed).toBe(1);
  }, 60_000);

  it("não apaga o motivo real quando o disparo perde a validade", async () => {
    const regra = await criarRegra({ trigger: "before_appointment", daysOffset: 1 });
    const cliente = await criarCliente(401);
    const vinteHoras = new Date(Date.now() - 20 * 3_600_000);
    await db.insert(s.automationDispatches).values({
      organizationId,
      ruleId: regra.id,
      customerId: cliente.id,
      sourceType: "appointment:2999-07-07",
      sourceId: 999_000_007,
      scheduledFor: vinteHoras,
      lastAttemptAt: vinteHoras,
      message: "Oi!",
      status: "failed",
      errorCode: "ENVIO_INCERTO",
      error: "A mensagem foi aceita pelo WhatsApp, mas algo falhou logo depois.",
    });

    await dispatchDueAutomations(new Date(), { organizationId, sleep: async () => {} });

    const [linha] = await disparos();
    // `ENVIO_INCERTO` é o ÚNICO desfecho de erro em que a cliente já recebeu.
    // Trocá-lo por `EXPIRADO` apaga o único fato que impede alguém de reenviar
    // à mão — e apaga junto o motivo real de qualquer outra falha diagnosticada.
    expect(linha.errorCode).toBe("ENVIO_INCERTO");
    expect(linha.error).toMatch(/aceita pelo WhatsApp/);
  });
});

// ---------------------------------------------------------------------------

describe("isolamento do banco compartilhado", () => {
  it("a varredura recortada por conta não escreve em nenhuma outra", async () => {
    const antes = await db.execute<{ total: number }>(
      sql`select count(*)::int as total from automation_dispatches where organization_id <> ${organizationId}`,
    );
    await criarRegra({ trigger: "before_appointment", daysOffset: 1 });
    const cliente = await criarCliente(300);
    const { eventAt, agora } = atendimentoEVencimento(30);
    await criarAgendamento(cliente.id, eventAt);
    await dispatchDueAutomations(agora, { organizationId, sleep: async () => {} });
    const depois = await db.execute<{ total: number }>(
      sql`select count(*)::int as total from automation_dispatches where organization_id <> ${organizationId}`,
    );
    expect(depois.rows[0].total).toBe(antes.rows[0].total);
  });
});
