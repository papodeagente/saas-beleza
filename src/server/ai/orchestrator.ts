import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  aiAgentKnowledge,
  aiAgentPermissions,
  aiAgents,
  aiExecutionLogs,
  aiUsageLogs,
  conversations,
  customers,
  messages,
  organizations,
} from "@/db/schema";
import type { TenantContext } from "@/server/auth";
import { complete, DEFAULT_MODEL, normalizeModel, type LlmItem } from "@/server/ai/llm";
import { formatForWhatsApp } from "@/server/ai/text-style";
import { findTool, toolsFor, type ToolOutcome, type ToolPermissions, type ToolRuntime } from "@/server/ai/tools";
import { formatTzCapitalized } from "@/lib/tz";

/**
 * Orquestrador do turno do agente.
 *
 * Atendimento real e simulador entram por esta mesma função. No entur-os-crm
 * essas duas rotas já foram código separado, e o resultado foi um simulador que
 * aprovava respostas que a conversa real não produzia — mesma configuração,
 * comportamento diferente. Aqui a única diferença entre os dois é `source`.
 */

const MAX_TOOL_ROUNDS = 6;
const HISTORY_LIMIT = 20;

export type AgentRecord = typeof aiAgents.$inferSelect;

export type LoadedAgent = {
  agent: AgentRecord;
  permissions: ToolPermissions;
};

const DEFAULT_PERMISSIONS: ToolPermissions = {
  readCustomer: true,
  readAppointments: true,
  readServices: true,
  readAvailability: true,
  readKnowledge: true,
  createAppointment: false,
  rescheduleAppointment: false,
  cancelAppointment: false,
  updateCustomer: false,
  addNote: true,
  transferToHuman: true,
};

export async function loadAgent(organizationId: number): Promise<LoadedAgent | null> {
  const [agent] = await db
    .select()
    .from(aiAgents)
    .where(eq(aiAgents.organizationId, organizationId))
    .orderBy(asc(aiAgents.id))
    .limit(1);
  if (!agent) return null;

  const [row] = await db
    .select()
    .from(aiAgentPermissions)
    .where(eq(aiAgentPermissions.agentId, agent.id))
    .limit(1);

  const permissions: ToolPermissions = row
    ? {
        readCustomer: row.readCustomer,
        readAppointments: row.readAppointments,
        readServices: row.readServices,
        readAvailability: row.readAvailability,
        readKnowledge: row.readKnowledge,
        createAppointment: row.createAppointment,
        rescheduleAppointment: row.rescheduleAppointment,
        cancelAppointment: row.cancelAppointment,
        updateCustomer: row.updateCustomer,
        addNote: row.addNote,
        transferToHuman: row.transferToHuman,
      }
    : DEFAULT_PERMISSIONS;

  return { agent, permissions };
}

/** Contexto de tenant sem usuário logado — o agente age em nome da organização. */
export async function systemContext(organizationId: number): Promise<TenantContext> {
  const [org] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      publicId: organizations.publicId,
      timezone: organizations.timezone,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org) throw new Error("Organização não encontrada.");

  return {
    organizationId: org.id,
    organizationName: org.name,
    organizationSlug: org.slug,
    organizationCode: org.publicId,
    timezone: org.timezone,
    // Zero em vez de um id real: o histórico registra a IA como autora, e
    // nenhuma ação fica creditada a uma pessoa que não a executou.
    userId: 0,
    userName: "Agente de IA",
    userEmail: "",
    role: "admin",
  };
}

/**
 * Histórico da conversa no formato do modelo.
 *
 * Builder único: o simulador chama exatamente esta função, com as mesmas
 * mensagens, para que o que ele testa seja o que o cliente recebe.
 */
export async function buildHistory(organizationId: number, conversationId: number): Promise<LlmItem[]> {
  const rows = await db
    .select({
      direction: messages.direction,
      sender: messages.sender,
      body: messages.body,
      transcription: messages.audioTranscription,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(eq(messages.organizationId, organizationId), eq(messages.conversationId, conversationId)))
    .orderBy(desc(messages.createdAt))
    .limit(HISTORY_LIMIT);

  return rows
    .reverse()
    .map((row): LlmItem | null => {
      const text = (row.transcription || row.body || "").trim();
      if (!text) return null;
      return row.direction === "inbound"
        ? { role: "user", content: text }
        : { role: "assistant", content: text };
    })
    .filter((item): item is LlmItem => item !== null);
}

function buildSystemPrompt(args: {
  ctx: TenantContext;
  agent: AgentRecord;
  customerName: string | null;
  knowledgeTitles: string[];
  hasCustomer: boolean;
}): string {
  const now = new Date();
  const parts: string[] = [];

  parts.push(
    `Você é ${args.agent.name}, atendente de ${args.ctx.organizationName} no WhatsApp.`,
    `Agora é ${formatTzCapitalized(now, args.ctx.timezone, "EEEE, dd 'de' MMMM 'de' yyyy, HH:mm")} (fuso ${args.ctx.timezone}).`,
  );

  if (args.agent.instructions?.trim()) {
    parts.push("", "Instruções do negócio:", args.agent.instructions.trim());
  }

  parts.push(
    "",
    "Como você escreve:",
    "- Mensagem de WhatsApp: curta, natural, no máximo três frases quando der.",
    "- Não use travessão, meia risca nem hífen como pontuação. Use vírgula ou ponto.",
    "- Não use títulos, marcadores nem formatação de documento.",
    "- Uma pergunta por vez. Não despeje o catálogo inteiro.",
    "",
    "Como você trabalha:",
    "- Preço, duração e horário livre vêm sempre das ferramentas. Nunca deduza nem invente.",
    "- Antes de oferecer horário, consulte a disponibilidade. A agenda muda o tempo todo.",
    "- Confirme serviço, data e hora com o cliente antes de agendar.",
    "- Se não souber, ou se o cliente pedir uma pessoa, transfira para uma atendente.",
    "- Nunca prometa o que não puder confirmar por ferramenta.",
  );

  if (args.customerName) {
    parts.push("", `Cliente desta conversa: ${args.customerName}.`);
  } else if (!args.hasCustomer) {
    parts.push("", "Ainda não sabemos quem é este contato. Pergunte o nome antes de agendar.");
  }

  if (args.knowledgeTitles.length > 0) {
    parts.push(
      "",
      `A base de conhecimento tem material sobre: ${args.knowledgeTitles.join(", ")}. Consulte com search_knowledge.`,
    );
  }

  if (args.agent.businessHoursOnly && args.agent.outOfHoursMessage) {
    parts.push("", `Fora do horário de atendimento, avise: ${args.agent.outOfHoursMessage}`);
  }

  return parts.join("\n");
}

export type TurnInput = {
  organizationId: number;
  conversationId: number;
  customerId: number | null;
  userText: string;
  /** Histórico pronto; se ausente, é lido do banco. */
  history?: LlmItem[];
  source: "whatsapp" | "simulator";
};

export type TurnResult = {
  reply: string;
  toolsUsed: string[];
  effect?: ToolOutcome["effect"];
  usage: { inputTokens: number; outputTokens: number };
  debug: { rounds: number; model: string };
};

export async function executeAgentTurn(input: TurnInput): Promise<TurnResult> {
  const loaded = await loadAgent(input.organizationId);
  if (!loaded) throw new Error("Nenhum agente configurado.");

  const ctx = await systemContext(input.organizationId);
  const { agent, permissions } = loaded;
  const model = normalizeModel(agent.model || DEFAULT_MODEL);

  const [customer] = input.customerId
    ? await db
        .select({ name: customers.name })
        .from(customers)
        .where(eq(customers.id, input.customerId))
        .limit(1)
    : [];

  const knowledge = await db
    .select({ title: aiAgentKnowledge.title })
    .from(aiAgentKnowledge)
    .where(and(eq(aiAgentKnowledge.organizationId, ctx.organizationId), eq(aiAgentKnowledge.active, true)))
    .limit(20);

  const system = buildSystemPrompt({
    ctx,
    agent,
    customerName: customer?.name ?? null,
    knowledgeTitles: knowledge.map((k) => k.title),
    hasCustomer: Boolean(input.customerId),
  });

  const history = input.history ?? (await buildHistory(input.organizationId, input.conversationId));
  const conversation: LlmItem[] = [...history, { role: "user", content: input.userText }];

  const tools = toolsFor(permissions);
  const runtime: ToolRuntime = {
    ctx,
    agentId: agent.id,
    conversationId: input.conversationId,
    customerId: input.customerId,
  };

  const toolsUsed: string[] = [];
  let effect: ToolOutcome["effect"] | undefined;
  const usage = { inputTokens: 0, outputTokens: 0 };
  let reply = "";
  let rounds = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    rounds = round + 1;
    const turn = await complete({
      model,
      system,
      messages: conversation,
      tools: tools.map((t) => t.definition),
      maxOutputTokens: agent.maxOutputTokens,
      temperature: agent.temperature / 100,
      extendedThinking: (agent.config as Record<string, unknown> | null)?.extendedThinking === true,
      effort: "low",
    });

    usage.inputTokens += turn.usage.inputTokens;
    usage.outputTokens += turn.usage.outputTokens;
    if (turn.text) reply = turn.text;

    if (turn.toolCalls.length === 0) break;

    conversation.push({ role: "assistant", content: turn.text, toolCalls: turn.toolCalls });

    for (const call of turn.toolCalls) {
      const tool = findTool(call.name);
      const startedAt = Date.now();
      let outcome: ToolOutcome;

      if (!tool) {
        outcome = { ok: false, data: { erro: `Ferramenta ${call.name} não existe.` } };
      } else if (permissions[tool.permission] !== true) {
        // Defesa em profundidade: a ferramenta não foi oferecida, mas se o
        // modelo inventar a chamada, ela não executa.
        outcome = { ok: false, data: { erro: "Sem permissão para esta ação." } };
      } else {
        try {
          outcome = await tool.execute(call.input, runtime);
        } catch (error) {
          outcome = { ok: false, data: { erro: error instanceof Error ? error.message : "Falha na ferramenta." } };
        }
      }

      toolsUsed.push(call.name);
      if (outcome.effect) effect = outcome.effect;

      void db
        .insert(aiExecutionLogs)
        .values({
          organizationId: ctx.organizationId,
          agentId: agent.id,
          conversationId: input.source === "simulator" ? null : input.conversationId,
          tool: call.name,
          input: call.input,
          output: outcome.data as Record<string, unknown>,
          ok: outcome.ok,
          result: outcome.ok ? "ok" : "error",
          durationMs: Date.now() - startedAt,
        })
        .catch(() => {});

      conversation.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: JSON.stringify(outcome.data),
      });
    }
  }

  void db
    .insert(aiUsageLogs)
    .values({
      organizationId: ctx.organizationId,
      agentId: agent.id,
      conversationId: input.source === "simulator" ? null : input.conversationId,
      feature: input.source === "simulator" ? "simulator" : "whatsapp",
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    })
    .catch(() => {});

  return {
    reply: formatForWhatsApp(reply),
    toolsUsed,
    effect,
    usage,
    debug: { rounds, model },
  };
}

export const _conversationsRef = conversations;
