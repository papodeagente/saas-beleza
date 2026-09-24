import "server-only";
import { and, asc, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  aiAgentCustomerMemos,
  aiAgentKnowledge,
  appointments,
  branches,
  conversations,
  customers,
  professionals,
  professionalServices,
  services,
} from "@/db/schema";
import type { TenantContext } from "@/server/auth";
import { getAvailableSlots, getAvailableSlotsByDay } from "@/server/services/availability-service";
import {
  changeStatus,
  createAppointment,
  rescheduleAppointment,
} from "@/server/services/appointment-service";
import { dateISOInTz, formatTz, localDateTimeToUtc } from "@/lib/tz";
import { formatBRL } from "@/lib/money";
import { cobrancaExigida, regraDeCobranca } from "@/server/services/asaas-account-service";
import { dispatchAppointmentCreatedAutomations } from "@/server/services/automation-service";
import { abrirCobranca } from "@/server/services/booking-payment-service";
import type { AgentToolDefinition } from "@/server/ai/llm";

/**
 * Ferramentas do agente.
 *
 * Duas regras estruturais, herdadas do entur-os-crm:
 *
 * 1. Nenhuma ferramenta fala com o banco por conta própria quando já existe um
 *    serviço de domínio. Agendar pela IA percorre exatamente o mesmo caminho de
 *    agendar pela tela, então choque de horário, buffer e transição de status
 *    valem igual. Uma segunda implementação divergiria em silêncio.
 *
 * 2. O prompt não autoriza nada. A permissão é lida do banco e filtra a lista
 *    de ferramentas antes de o modelo ver o que existe — o que está desligado
 *    nem é oferecido.
 */

export type ToolPermissions = {
  readCustomer: boolean;
  readAppointments: boolean;
  readServices: boolean;
  readAvailability: boolean;
  readKnowledge: boolean;
  createAppointment: boolean;
  rescheduleAppointment: boolean;
  cancelAppointment: boolean;
  updateCustomer: boolean;
  addNote: boolean;
  transferToHuman: boolean;
};

export type ToolRuntime = {
  ctx: TenantContext;
  agentId: number;
  conversationId: number;
  customerId: number | null;
};

export type ToolOutcome = {
  ok: boolean;
  data: unknown;
  /** Efeito visível na conversa, aplicado pelo processador depois do turno. */
  effect?: { type: "transfer_to_human"; reason: string; summary: string };
};

export type AgentTool = {
  definition: AgentToolDefinition;
  permission: keyof ToolPermissions;
  execute: (input: Record<string, unknown>, runtime: ToolRuntime) => Promise<ToolOutcome>;
};

const brl = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;

function requireCustomer(runtime: ToolRuntime): number {
  if (!runtime.customerId) {
    throw new Error("Ainda não sei quem é este cliente. Pergunte o nome antes de continuar.");
  }
  return runtime.customerId;
}

/**
 * O agendamento é DESTA cliente, ou a ferramenta não mexe nele.
 *
 * Remarcar e cancelar recebem um `appointmentId` cru vindo do modelo, e o
 * domínio filtra só por organização — o suficiente para não atravessar a
 * fronteira entre clínicas, e insuficiente dentro de uma. Os ids são
 * sequenciais e pequenos: um número alucinado, ou ditado pela própria cliente,
 * cancelava o atendimento de OUTRA pessoa do mesmo salão, e ainda somava uma
 * falta no histórico da vítima.
 *
 * Não era exposição teórica: sem esta guarda, ligar "remarcar" e "cancelar" na
 * configuração padrão abriria o buraco em todas as contas de uma vez.
 *
 * A mensagem de erro é escrita para o modelo repassar: ela não revela que o
 * agendamento existe e é de outra pessoa.
 */
async function assertAgendamentoDaCliente(runtime: ToolRuntime, appointmentId: number): Promise<void> {
  const customerId = requireCustomer(runtime);
  const [linha] = await db
    .select({ customerId: appointments.customerId })
    .from(appointments)
    .where(
      and(
        eq(appointments.id, appointmentId),
        eq(appointments.organizationId, runtime.ctx.organizationId),
      ),
    )
    .limit(1);

  if (!linha || linha.customerId !== customerId) {
    throw new Error("Não encontrei esse atendimento no cadastro desta cliente.");
  }
}

function str(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value.trim() : "";
}

function num(input: Record<string, unknown>, key: string): number | null {
  const value = input[key];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A profissional existe nesta conta E atende este serviço?
 *
 * Mesma armadilha do id de serviço: profissional chutada, ou que não faz aquele
 * serviço, deixa a grade vazia e a ferramenta dizia "sem horário". A cliente
 * ouvia "não tem vaga" quando a verdade era "essa pessoa não faz isso".
 */
async function profissionalDoServico(
  runtime: ToolRuntime,
  professionalId: number,
  serviceId: number,
): Promise<{ ok: true } | { ok: false; data: { erro: string } }> {
  const [faz] = await db
    .select({ id: professionals.id })
    .from(professionalServices)
    .innerJoin(professionals, eq(professionals.id, professionalServices.professionalId))
    .where(
      and(
        eq(professionalServices.organizationId, runtime.ctx.organizationId),
        eq(professionalServices.professionalId, professionalId),
        eq(professionalServices.serviceId, serviceId),
        eq(professionals.active, true),
      ),
    )
    .limit(1);
  if (faz) return { ok: true };

  const equipe = await db
    .select({ id: professionals.id, name: professionals.name })
    .from(professionalServices)
    .innerJoin(professionals, eq(professionals.id, professionalServices.professionalId))
    .where(
      and(
        eq(professionalServices.organizationId, runtime.ctx.organizationId),
        eq(professionalServices.serviceId, serviceId),
        eq(professionals.active, true),
      ),
    )
    .orderBy(asc(professionals.name))
    .limit(20);

  return {
    ok: false,
    data: {
      erro:
        equipe.length > 0
          ? `Quem atende este serviço é: ${equipe.map((p) => `${p.id} (${p.name})`).join(", ")}. NÃO diga que não há horário: repita a consulta sem escolher profissional, ou use um destes ids.`
          : "Nenhuma profissional está habilitada para este serviço. Transfira para uma atendente.",
    },
  };
}

/**
 * O id do serviço existe NESTA conta?
 *
 * Esta guarda é a correção de um atendimento que mentiu para a cliente. O
 * modelo chutou `serviceId: 1` em vez do 357 que `list_services` acabara de
 * devolver, e a disponibilidade respondeu `total: 0` — porque serviço
 * inexistente e agenda cheia produziam exatamente a mesma resposta. O agente
 * então disse "não tem horário livre nos próximos 7 dias" com a agenda vazia,
 * oferecendo fila de espera para um salão que tinha 37 horários naquele dia.
 *
 * Id inválido agora é ERRO, com a lista do que existe. Modelo chuta id: isso é
 * fato da vida, e quem tem que recusar é a ferramenta, não a sorte.
 */
async function servicoDaConta(
  runtime: ToolRuntime,
  serviceId: number,
): Promise<{ ok: true } | { ok: false; data: { erro: string } }> {
  const [existe] = await db
    .select({ id: services.id })
    .from(services)
    .where(and(eq(services.organizationId, runtime.ctx.organizationId), eq(services.id, serviceId)))
    .limit(1);
  if (existe) return { ok: true };

  const catalogo = await db
    .select({ id: services.id, name: services.name })
    .from(services)
    .where(and(eq(services.organizationId, runtime.ctx.organizationId), eq(services.active, true)))
    .orderBy(asc(services.name))
    .limit(30);

  return {
    ok: false,
    data: {
      erro:
        catalogo.length > 0
          ? `O serviço ${serviceId} não existe nesta agenda. Use um destes ids: ${catalogo
              .map((c) => `${c.id} (${c.name})`)
              .join(", ")}. NÃO diga que não há horário: você usou um id errado.`
          : `O serviço ${serviceId} não existe nesta agenda e não há serviço publicado. Transfira para uma atendente.`,
    },
  };
}

// ── Leitura ───────────────────────────────────────────────────────────────

const listServices: AgentTool = {
  permission: "readServices",
  definition: {
    name: "list_services",
    description:
      "Lista os serviços oferecidos, com duração e preço. Use sempre antes de falar preço ou de agendar, nunca invente valores.",
    parameters: {
      type: "object",
      properties: {
        search: { type: "string", description: "Filtro por nome, opcional." },
      },
      required: [],
      additionalProperties: false,
    },
  },
  async execute(input, runtime) {
    const search = str(input, "search");
    const rows = await db
      .select({
        id: services.id,
        name: services.name,
        description: services.description,
        durationMin: services.durationMin,
        priceCents: services.priceCents,
      })
      .from(services)
      .where(
        and(
          eq(services.organizationId, runtime.ctx.organizationId),
          eq(services.active, true),
          search ? ilike(services.name, `%${search}%`) : undefined,
        ),
      )
      .orderBy(asc(services.name))
      .limit(50);

    return {
      ok: true,
      data: rows.map((row) => ({
        serviceId: row.id,
        nome: row.name,
        descricao: row.description,
        duracaoMinutos: row.durationMin,
        preco: brl(row.priceCents),
      })),
    };
  },
};

const listProfessionals: AgentTool = {
  permission: "readServices",
  definition: {
    name: "list_professionals",
    description: "Lista os profissionais ativos. Use quando o cliente pedir alguém específico.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  async execute(_input, runtime) {
    const rows = await db
      .select({ id: professionals.id, name: professionals.name })
      .from(professionals)
      .where(and(eq(professionals.organizationId, runtime.ctx.organizationId), eq(professionals.active, true)))
      .orderBy(asc(professionals.name));
    return { ok: true, data: rows.map((r) => ({ professionalId: r.id, nome: r.name })) };
  },
};

const checkAvailability: AgentTool = {
  permission: "readAvailability",
  definition: {
    name: "check_availability",
    description:
      "Horários livres de um serviço numa data. Consulte antes de oferecer horário: a agenda muda o tempo todo e oferecer horário ocupado gera conflito real.",
    parameters: {
      type: "object",
      properties: {
        serviceId: { type: "number", description: "Id do serviço, vindo de list_services." },
        date: { type: "string", description: "Data no formato AAAA-MM-DD." },
        professionalId: { type: "number", description: "Profissional específico, opcional." },
      },
      required: ["serviceId", "date"],
      additionalProperties: false,
    },
  },
  async execute(input, runtime) {
    const serviceId = num(input, "serviceId");
    const date = str(input, "date");
    if (!serviceId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { ok: false, data: { erro: "Informe serviceId e date no formato AAAA-MM-DD." } };
    }
    const valido = await servicoDaConta(runtime, serviceId);
    if (!valido.ok) return valido;

    const professionalId = num(input, "professionalId") ?? undefined;
    if (professionalId) {
      const atende = await profissionalDoServico(runtime, professionalId, serviceId);
      if (!atende.ok) return atende;
    }
    const slots = await getAvailableSlots(runtime.ctx, { serviceId, dateISO: date, professionalId });

    // O slot carrega só o id do profissional; o nome é o que serve para o
    // cliente ouvir ("com a Paula às 14h").
    const names = new Map<number, string>();
    if (slots.length > 0) {
      const rows = await db
        .select({ id: professionals.id, name: professionals.name })
        .from(professionals)
        .where(eq(professionals.organizationId, runtime.ctx.organizationId));
      for (const row of rows) names.set(row.id, row.name);
    }

    return {
      ok: true,
      data: {
        data: date,
        horarios: slots.slice(0, 40).map((slot) => ({
          hora: formatTz(slot.start, runtime.ctx.timezone, "HH:mm"),
          professionalId: slot.professionalId,
          profissional: names.get(slot.professionalId) ?? null,
        })),
        total: slots.length,
      },
    };
  },
};

/**
 * Os próximos dias com vaga, de uma vez.
 *
 * Existe porque `check_availability` exige UMA data, e a cliente não fala por
 * data: fala "tem essa semana?", "tem alguma coisa de manhã?". Sem varredura, o
 * modelo chuta data por data e queima as seis rodadas de ferramenta do turno —
 * e quando a última rodada só chama ferramenta, a resposta sai VAZIA e a
 * cliente fica sem retorno nenhum.
 *
 * Devolve poucas opções de propósito. Despejar trinta horários num WhatsApp é
 * o contrário de atender: quem escolhe bem escolhe entre três.
 *
 * Reusa `getAvailableSlotsByDay`, a mesma varredura do calendário público, que
 * carrega serviço, profissionais, jornada, agendamentos e bloqueios UMA vez
 * para o intervalo inteiro. Consultar dez dias custa o mesmo que consultar um.
 */
const proximosHorarios: AgentTool = {
  permission: "readAvailability",
  definition: {
    name: "next_available_slots",
    description:
      "Próximos horários livres de um serviço, varrendo vários dias. Use quando o cliente não disser uma data exata (esta semana, amanhã de manhã, depois das 18h).",
    parameters: {
      type: "object",
      properties: {
        serviceId: { type: "number", description: "Id do serviço, vindo de list_services." },
        diasAFrente: { type: "number", description: "Quantos dias varrer a partir de hoje. Padrão 14, máximo 30." },
        periodo: {
          type: "string",
          enum: ["manha", "tarde", "noite", "qualquer"],
          description: "Recorte do dia pedido pelo cliente.",
        },
        professionalId: { type: "number", description: "Profissional específico, opcional." },
      },
      required: ["serviceId"],
      additionalProperties: false,
    },
  },
  async execute(input, runtime) {
    const serviceId = num(input, "serviceId");
    if (!serviceId) return { ok: false, data: { erro: "Informe serviceId." } };

    const valido = await servicoDaConta(runtime, serviceId);
    if (!valido.ok) return valido;

    const pedido = num(input, "diasAFrente") ?? 14;
    const dias = Math.max(1, Math.min(30, pedido));
    const hoje = dateISOInTz(new Date(), runtime.ctx.timezone);
    const datas = Array.from({ length: dias }, (_, i) => {
      const d = new Date(`${hoje}T12:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    });

    const pedida = num(input, "professionalId") ?? undefined;
    if (pedida) {
      const atende = await profissionalDoServico(runtime, pedida, serviceId);
      if (!atende.ok) return atende;
    }

    const porDia = await getAvailableSlotsByDay(runtime.ctx, {
      serviceId,
      dateISOs: datas,
      professionalId: pedida,
    });

    const periodo = str(input, "periodo") || "qualquer";
    const dentroDoPeriodo = (hora: string) => {
      const h = Number(hora.slice(0, 2));
      if (periodo === "manha") return h < 12;
      if (periodo === "tarde") return h >= 12 && h < 18;
      if (periodo === "noite") return h >= 18;
      return true;
    };

    const nomes = new Map<number, string>();
    const linhas = await db
      .select({ id: professionals.id, name: professionals.name })
      .from(professionals)
      .where(eq(professionals.organizationId, runtime.ctx.organizationId));
    for (const linha of linhas) nomes.set(linha.id, linha.name);

    /**
     * No máximo dois horários por dia e quatro no total: o objetivo é uma
     * escolha fácil, não um inventário. O `total` vai junto para o agente poder
     * dizer "tenho mais opções" sem listar todas.
     */
    const opcoes: Array<{ data: string; hora: string; professionalId: number; profissional: string | null }> = [];
    let total = 0;
    for (const data of datas) {
      const doDia = (porDia.get(data) ?? []).filter((slot) =>
        dentroDoPeriodo(formatTz(slot.start, runtime.ctx.timezone, "HH:mm")),
      );
      /**
       * Um horário por vez, mesmo com várias profissionais livres nele.
       *
       * A varredura emite um slot por profissional, então um salão com três
       * manicures devolve "10:00" três vezes. Sem juntar, as quatro opções
       * viram o mesmo horário repetido e o total mente sobre quantas escolhas
       * a cliente realmente tem.
       */
      const porHora = new Map<string, (typeof doDia)[number]>();
      for (const slot of doDia) {
        const hora = formatTz(slot.start, runtime.ctx.timezone, "HH:mm");
        if (!porHora.has(hora)) porHora.set(hora, slot);
      }
      total += porHora.size;
      for (const [hora, slot] of [...porHora.entries()].slice(0, 2)) {
        if (opcoes.length >= 4) break;
        opcoes.push({
          data,
          hora,
          professionalId: slot.professionalId,
          profissional: nomes.get(slot.professionalId) ?? null,
        });
      }
    }

    if (opcoes.length === 0) {
      return {
        ok: true,
        data: {
          opcoes: [],
          total: 0,
          aviso: `Nenhum horário livre nos próximos ${dias} dias para este serviço. Não invente outra data: ofereça avisar quando abrir vaga, ou transfira para uma atendente.`,
        },
      };
    }

    return { ok: true, data: { opcoes, total, periodo } };
  },
};

const getCustomerTool: AgentTool = {
  permission: "readCustomer",
  definition: {
    name: "get_customer",
    description:
      "Dados do cliente desta conversa: nome, histórico, quantas vezes veio, última visita e o que o agente já anotou sobre ele.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  async execute(_input, runtime) {
    const customerId = requireCustomer(runtime);
    const [customer] = await db
      .select({
        id: customers.id,
        name: customers.name,
        phone: customers.phone,
        email: customers.email,
        visitsCount: customers.visitsCount,
        noShowCount: customers.noShowCount,
        lastVisitAt: customers.lastVisitAt,
        notes: customers.notes,
      })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.organizationId, runtime.ctx.organizationId)))
      .limit(1);
    if (!customer) return { ok: false, data: { erro: "Cliente não encontrado." } };

    const [memo] = await db
      .select({ content: aiAgentCustomerMemos.content })
      .from(aiAgentCustomerMemos)
      .where(
        and(
          eq(aiAgentCustomerMemos.organizationId, runtime.ctx.organizationId),
          eq(aiAgentCustomerMemos.customerId, customerId),
        ),
      )
      .limit(1);

    return {
      ok: true,
      data: {
        nome: customer.name,
        telefone: customer.phone,
        email: customer.email,
        visitas: customer.visitsCount,
        faltas: customer.noShowCount,
        ultimaVisita: customer.lastVisitAt ? dateISOInTz(customer.lastVisitAt, runtime.ctx.timezone) : null,
        observacoes: customer.notes,
        anotacoesDoAgente: memo?.content ?? null,
      },
    };
  },
};

const listCustomerAppointments: AgentTool = {
  permission: "readAppointments",
  definition: {
    name: "list_customer_appointments",
    description:
      "Agendamentos do cliente desta conversa. Use antes de remarcar ou cancelar, para saber de qual agendamento ele está falando.",
    parameters: {
      type: "object",
      properties: {
        somenteFuturos: { type: "boolean", description: "Padrão: true." },
      },
      required: [],
      additionalProperties: false,
    },
  },
  async execute(input, runtime) {
    const customerId = requireCustomer(runtime);
    const onlyFuture = input.somenteFuturos !== false;
    const rows = await db
      .select({
        id: appointments.id,
        startsAt: appointments.startsAt,
        status: appointments.status,
        serviceName: services.name,
        professionalName: professionals.name,
        branchName: branches.name,
      })
      .from(appointments)
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .innerJoin(professionals, eq(professionals.id, appointments.professionalId))
      .leftJoin(branches, eq(branches.id, appointments.branchId))
      .where(
        and(
          eq(appointments.organizationId, runtime.ctx.organizationId),
          eq(appointments.customerId, customerId),
          onlyFuture ? gte(appointments.startsAt, new Date()) : undefined,
        ),
      )
      .orderBy(onlyFuture ? asc(appointments.startsAt) : desc(appointments.startsAt))
      .limit(20);

    return {
      ok: true,
      data: rows.map((row) => ({
        appointmentId: row.id,
        quando: formatTz(row.startsAt, runtime.ctx.timezone, "dd/MM/yyyy 'às' HH:mm"),
        servico: row.serviceName,
        profissional: row.professionalName,
        unidade: row.branchName,
        status: row.status,
      })),
    };
  },
};

const searchKnowledge: AgentTool = {
  permission: "readKnowledge",
  definition: {
    name: "search_knowledge",
    description:
      "Consulta a base de conhecimento do negócio (políticas, cuidados, formas de pagamento, endereço). Use quando perguntarem algo que não está no catálogo nem na agenda.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "O que procurar." } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  async execute(input, runtime) {
    const query = str(input, "query");
    if (!query) return { ok: false, data: { erro: "Informe o que procurar." } };
    const rows = await db
      .select({ title: aiAgentKnowledge.title, content: aiAgentKnowledge.content })
      .from(aiAgentKnowledge)
      .where(
        and(
          eq(aiAgentKnowledge.organizationId, runtime.ctx.organizationId),
          eq(aiAgentKnowledge.active, true),
          or(ilike(aiAgentKnowledge.title, `%${query}%`), ilike(aiAgentKnowledge.content, `%${query}%`)),
        ),
      )
      .limit(5);
    if (rows.length === 0) {
      return { ok: true, data: { encontrado: false, aviso: "Nada na base. Não invente: ofereça transferir para uma atendente." } };
    }
    return { ok: true, data: { encontrado: true, artigos: rows } };
  },
};

// ── Escrita ───────────────────────────────────────────────────────────────

const createAppointmentTool: AgentTool = {
  permission: "createAppointment",
  definition: {
    name: "create_appointment",
    description:
      "Agenda um horário para o cliente desta conversa. Só chame depois de confirmar serviço, data e hora com ele, e depois de ver o horário livre em check_availability. Quando a clínica exige pagamento, a resposta traz `pagamento` em vez de `confirmado`: aí o horário está apenas guardado até o pagamento entrar.",
    parameters: {
      type: "object",
      properties: {
        serviceId: { type: "number" },
        professionalId: { type: "number" },
        date: { type: "string", description: "AAAA-MM-DD" },
        time: { type: "string", description: "HH:mm" },
        observacao: { type: "string" },
      },
      required: ["serviceId", "professionalId", "date", "time"],
      additionalProperties: false,
    },
  },
  async execute(input, runtime) {
    const customerId = requireCustomer(runtime);
    const serviceId = num(input, "serviceId");
    const professionalId = num(input, "professionalId");
    const date = str(input, "date");
    const time = str(input, "time");
    if (!serviceId || !professionalId || !date || !time) {
      return { ok: false, data: { erro: "Faltam serviceId, professionalId, date ou time." } };
    }

    const [branch] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.organizationId, runtime.ctx.organizationId), eq(branches.active, true)))
      .orderBy(asc(branches.id))
      .limit(1);
    if (!branch) return { ok: false, data: { erro: "Nenhuma unidade ativa." } };

    const startsAt = localDateTimeToUtc(date, time, runtime.ctx.timezone);
    try {
      const created = await createAppointment(runtime.ctx, {
        customerId,
        serviceId,
        professionalId,
        branchId: branch.id,
        startsAt,
        notes: str(input, "observacao") || null,
        source: "ai",
        conversationId: runtime.conversationId,
      });
      const quando = formatTz(startsAt, runtime.ctx.timezone, "dd/MM/yyyy 'às' HH:mm");

      /**
       * Clínica que exige pagamento: o horário está GUARDADO, não confirmado.
       *
       * Sem este trecho o agente seria o furo do recurso — a página pública
       * cobraria e o WhatsApp, que é por onde a maioria agenda, confirmaria de
       * graça. Por isso a resposta da ferramenta muda de forma: não existe
       * campo `confirmado` aqui, só `pagamento`, para o modelo não ter como
       * anunciar confirmação que não houve.
       */
      if (await cobrancaExigida(runtime.ctx.organizationId)) {
        try {
          const regra = await regraDeCobranca(runtime.ctx.organizationId);
          const cobranca = await abrirCobranca(runtime.ctx.organizationId, created.id);
          // Serviço abaixo do mínimo do Asaas não tem como ser cobrado: o
          // agendamento vale como qualquer outro, inclusive na confirmação que
          // a criação segurou por causa do portão de pagamento.
          if (!cobranca) {
            await dispatchAppointmentCreatedAutomations(runtime.ctx, created.id).catch(() => undefined);
            return { ok: true, data: { appointmentId: created.id, confirmado: quando } };
          }

          return {
            ok: true,
            data: {
              appointmentId: created.id,
              horarioGuardado: quando,
              pagamento: {
                valor: formatBRL(cobranca.valorCents),
                link: cobranca.url,
                prazoMinutos: regra.minutosDeReserva,
              },
              instrucao:
                "O horário está guardado, mas NÃO confirmado. Mande o link de pagamento e o valor para o cliente, diga em quantos minutos o pagamento precisa ser feito e avise que a confirmação chega sozinha quando o pagamento entrar. Não diga que o agendamento está confirmado.",
            },
          };
        } catch (erro) {
          // Cobrança que não abriu não pode virar agendamento confirmado de
          // graça: quem decide o que fazer é a clínica, então transfere.
          console.error("[agente] cobrança não aberta:", erro instanceof Error ? erro.message : erro);
          return {
            ok: false,
            data: {
              erro: "Agendei o horário, mas não consegui gerar o link de pagamento. Avise o cliente que a recepção vai mandar o link e transfira o atendimento.",
              appointmentId: created.id,
            },
          };
        }
      }

      return {
        ok: true,
        data: {
          appointmentId: created.id,
          confirmado: quando,
        },
      };
    } catch (error) {
      // O erro de domínio é a resposta correta ao cliente: "esse horário acabou
      // de ser ocupado" é informação, não falha do agente.
      return { ok: false, data: { erro: error instanceof Error ? error.message : "Não consegui agendar." } };
    }
  },
};

const rescheduleTool: AgentTool = {
  permission: "rescheduleAppointment",
  definition: {
    name: "reschedule_appointment",
    description: "Muda um agendamento existente para outra data e hora. Confirme o novo horário em check_availability antes.",
    parameters: {
      type: "object",
      properties: {
        appointmentId: { type: "number" },
        date: { type: "string", description: "AAAA-MM-DD" },
        time: { type: "string", description: "HH:mm" },
        professionalId: { type: "number", description: "Se mudar de profissional." },
      },
      required: ["appointmentId", "date", "time"],
      additionalProperties: false,
    },
  },
  async execute(input, runtime) {
    const appointmentId = num(input, "appointmentId");
    const date = str(input, "date");
    const time = str(input, "time");
    if (!appointmentId || !date || !time) {
      return { ok: false, data: { erro: "Faltam appointmentId, date ou time." } };
    }
    const startsAt = localDateTimeToUtc(date, time, runtime.ctx.timezone);
    try {
      await assertAgendamentoDaCliente(runtime, appointmentId);
      await rescheduleAppointment(
        runtime.ctx,
        appointmentId,
        startsAt,
        num(input, "professionalId") ?? undefined,
        { type: "ai", id: null },
        // Origem "ai": remarcar pelo agente respeita a grade da clínica, como
        // criar já respeitava. Encaixe fora do expediente continua sendo
        // privilégio de quem está na tela.
        "ai",
      );
      return { ok: true, data: { remarcado: formatTz(startsAt, runtime.ctx.timezone, "dd/MM/yyyy 'às' HH:mm") } };
    } catch (error) {
      return { ok: false, data: { erro: error instanceof Error ? error.message : "Não consegui remarcar." } };
    }
  },
};

const cancelTool: AgentTool = {
  permission: "cancelAppointment",
  definition: {
    name: "cancel_appointment",
    description: "Cancela um agendamento. Confirme com o cliente antes: cancelamento não se desfaz.",
    parameters: {
      type: "object",
      properties: {
        appointmentId: { type: "number" },
        motivo: { type: "string" },
      },
      required: ["appointmentId"],
      additionalProperties: false,
    },
  },
  async execute(input, runtime) {
    const appointmentId = num(input, "appointmentId");
    if (!appointmentId) return { ok: false, data: { erro: "Informe appointmentId." } };
    try {
      await assertAgendamentoDaCliente(runtime, appointmentId);
      await changeStatus(runtime.ctx, appointmentId, "cancelled", {
        cancelReason: str(input, "motivo") || "Cancelado pelo cliente no WhatsApp",
        actor: { type: "ai", id: null },
      });
      return { ok: true, data: { cancelado: true } };
    } catch (error) {
      return { ok: false, data: { erro: error instanceof Error ? error.message : "Não consegui cancelar." } };
    }
  },
};

const updateCustomerTool: AgentTool = {
  permission: "updateCustomer",
  definition: {
    name: "update_customer",
    description: "Completa o cadastro do cliente com o que ele informou (nome, e-mail, aniversário).",
    parameters: {
      type: "object",
      properties: {
        nome: { type: "string" },
        email: { type: "string" },
        aniversario: { type: "string", description: "AAAA-MM-DD" },
      },
      required: [],
      additionalProperties: false,
    },
  },
  async execute(input, runtime) {
    const customerId = requireCustomer(runtime);
    const patch: Record<string, unknown> = {};
    const nome = str(input, "nome");
    const email = str(input, "email");
    const aniversario = str(input, "aniversario");
    if (nome) patch.name = nome;
    if (email) patch.email = email;
    if (/^\d{4}-\d{2}-\d{2}$/.test(aniversario)) patch.birthdate = aniversario;
    if (Object.keys(patch).length === 0) return { ok: false, data: { erro: "Nada para atualizar." } };

    await db
      .update(customers)
      .set(patch)
      .where(and(eq(customers.id, customerId), eq(customers.organizationId, runtime.ctx.organizationId)));
    return { ok: true, data: { atualizado: Object.keys(patch) } };
  },
};

const addNoteTool: AgentTool = {
  permission: "addNote",
  definition: {
    name: "add_note",
    description:
      "Guarda o que você aprendeu sobre o cliente (preferências, alergias, restrição de horário). Existe uma anotação por cliente: mande o texto completo atualizado, não só o trecho novo.",
    parameters: {
      type: "object",
      properties: { conteudo: { type: "string" } },
      required: ["conteudo"],
      additionalProperties: false,
    },
  },
  async execute(input, runtime) {
    const customerId = requireCustomer(runtime);
    const conteudo = str(input, "conteudo");
    if (!conteudo) return { ok: false, data: { erro: "Conteúdo vazio." } };

    // Uma anotação por cliente: o upsert evita a enxurrada de notas repetidas
    // que polui a ficha.
    await db
      .insert(aiAgentCustomerMemos)
      .values({ organizationId: runtime.ctx.organizationId, customerId, content: conteudo })
      .onConflictDoUpdate({
        target: [aiAgentCustomerMemos.organizationId, aiAgentCustomerMemos.customerId],
        set: { content: conteudo, updatedAt: new Date() },
      });
    return { ok: true, data: { salvo: true } };
  },
};

const transferTool: AgentTool = {
  permission: "transferToHuman",
  definition: {
    name: "transfer_to_human",
    description:
      "Passa a conversa para uma atendente humana. Use quando o cliente pedir, quando reclamar, quando o assunto sair do seu alcance ou quando você não tiver a informação. Depois de transferir, não continue respondendo.",
    parameters: {
      type: "object",
      properties: {
        motivo: { type: "string", description: "Por que está transferindo." },
        resumo: { type: "string", description: "Resumo curto do que o cliente quer, para a atendente." },
      },
      required: ["motivo"],
      additionalProperties: false,
    },
  },
  async execute(input) {
    const motivo = str(input, "motivo") || "Solicitação do cliente";
    const resumo = str(input, "resumo") || motivo;
    // O efeito é aplicado pelo processador ao fim do turno, junto com a última
    // mensagem — assim a conversa não muda de dono no meio de uma resposta.
    return {
      ok: true,
      data: { transferido: true, aviso: "Conversa encaminhada. Se despeça e não responda mais nesta conversa." },
      effect: { type: "transfer_to_human", reason: motivo, summary: resumo },
    };
  },
};

const ALL_TOOLS: AgentTool[] = [
  listServices,
  listProfessionals,
  checkAvailability,
  proximosHorarios,
  getCustomerTool,
  listCustomerAppointments,
  searchKnowledge,
  createAppointmentTool,
  rescheduleTool,
  cancelTool,
  updateCustomerTool,
  addNoteTool,
  transferTool,
];

/** Só as ferramentas liberadas nas permissões — o modelo nem vê o resto. */
export function toolsFor(permissions: ToolPermissions): AgentTool[] {
  return ALL_TOOLS.filter((tool) => permissions[tool.permission] === true);
}

export function findTool(name: string): AgentTool | undefined {
  return ALL_TOOLS.find((tool) => tool.definition.name === name);
}

export const ALL_TOOL_NAMES = ALL_TOOLS.map((t) => t.definition.name);
export const _sqlRef = sql;
export { conversations as _conversationsRef };
