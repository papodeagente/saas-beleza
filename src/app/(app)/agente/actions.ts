"use server";

import { and, asc, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { aiAgentKnowledge, aiAgentPermissions, aiAgents } from "@/db/schema";
import { requireRole, requireSession } from "@/server/auth";
import { AGENT_MODELS, hasApiKeyFor, normalizeModel } from "@/server/ai/llm";
import { executeAgentTurn } from "@/server/ai/orchestrator";
import { invalidateAgentCache } from "@/server/queues/agent-turn-queue";

export type ActionResult = { ok: true } | { ok: false; error: string };

const configSchema = z.object({
  name: z.string().trim().min(1).max(60),
  status: z.enum(["off", "testing", "active"]),
  enabled: z.boolean(),
  instructions: z.string().trim().max(8000),
  model: z.string().trim().min(1),
  temperature: z.number().int().min(0).max(100),
  maxOutputTokens: z.number().int().min(100).max(4000),
  debounceWindowSeconds: z.number().int().min(0).max(120),
  responseDelaySeconds: z.number().int().min(0).max(120),
  pauseOnHumanReply: z.boolean(),
  respondGroups: z.boolean(),
  businessHoursOnly: z.boolean(),
  outOfHoursMessage: z.string().trim().max(500).nullable(),
  maxTurnsPerMinutePerOrg: z.number().int().min(1).max(300),
  maxTurnsPerMinutePerContact: z.number().int().min(1).max(60),
  extendedThinking: z.boolean(),
});

/**
 * Salva a configuração do agente.
 *
 * Ligar em "atendendo" sem chave do provedor deixaria o agente calado sem dizer
 * por quê, então essa combinação é barrada aqui, com o motivo explícito.
 */
export async function saveAgentAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    const data = configSchema.parse(input);
    const model = normalizeModel(data.model);

    if (data.status === "active" && data.enabled && !hasApiKeyFor(model)) {
      const provider = AGENT_MODELS.find((m) => m.id === model)?.provider ?? "anthropic";
      return {
        ok: false,
        error:
          provider === "anthropic"
            ? "Falta a chave da Anthropic no servidor (ANTHROPIC_API_KEY). Sem ela o agente não responde."
            : "Falta a chave da OpenAI no servidor (OPENAI_API_KEY). Sem ela o agente não responde.",
      };
    }

    const [existing] = await db
      .select({ id: aiAgents.id })
      .from(aiAgents)
      .where(eq(aiAgents.organizationId, ctx.organizationId))
      .orderBy(asc(aiAgents.id))
      .limit(1);

    const values = {
      name: data.name,
      status: data.status,
      enabled: data.enabled,
      instructions: data.instructions,
      model,
      temperature: data.temperature,
      maxOutputTokens: data.maxOutputTokens,
      debounceWindowSeconds: data.debounceWindowSeconds,
      responseDelaySeconds: data.responseDelaySeconds,
      pauseOnHumanReply: data.pauseOnHumanReply,
      respondGroups: data.respondGroups,
      businessHoursOnly: data.businessHoursOnly,
      outOfHoursMessage: data.outOfHoursMessage,
      maxTurnsPerMinutePerOrg: data.maxTurnsPerMinutePerOrg,
      maxTurnsPerMinutePerContact: data.maxTurnsPerMinutePerContact,
      config: { extendedThinking: data.extendedThinking },
      updatedAt: new Date(),
    };

    if (existing) {
      await db.update(aiAgents).set(values).where(eq(aiAgents.id, existing.id));
    } else {
      const [created] = await db
        .insert(aiAgents)
        .values({ ...values, organizationId: ctx.organizationId })
        .returning({ id: aiAgents.id });
      await db
        .insert(aiAgentPermissions)
        .values({ agentId: created.id, organizationId: ctx.organizationId })
        .onConflictDoNothing();
    }

    // A fila guarda a configuração por um minuto; sem invalidar, mudar o modo
    // levaria até um minuto para valer.
    invalidateAgentCache(ctx.organizationId);
    revalidatePath("/agente");
    return { ok: true };
  } catch (error) {
    console.error(error);
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível salvar." };
  }
}

const permissionsSchema = z.object({
  readCustomer: z.boolean(),
  readAppointments: z.boolean(),
  readServices: z.boolean(),
  readAvailability: z.boolean(),
  readKnowledge: z.boolean(),
  createAppointment: z.boolean(),
  rescheduleAppointment: z.boolean(),
  cancelAppointment: z.boolean(),
  updateCustomer: z.boolean(),
  addNote: z.boolean(),
  transferToHuman: z.boolean(),
});

/** As permissões são o gate real: o que está desligado nem é oferecido ao modelo. */
export async function savePermissionsAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    const data = permissionsSchema.parse(input);

    const [agent] = await db
      .select({ id: aiAgents.id })
      .from(aiAgents)
      .where(eq(aiAgents.organizationId, ctx.organizationId))
      .orderBy(asc(aiAgents.id))
      .limit(1);
    if (!agent) return { ok: false, error: "Salve a configuração do agente primeiro." };

    await db
      .insert(aiAgentPermissions)
      .values({ ...data, agentId: agent.id, organizationId: ctx.organizationId })
      .onConflictDoUpdate({
        target: [aiAgentPermissions.agentId],
        set: { ...data, updatedAt: new Date() },
      });

    revalidatePath("/agente");
    return { ok: true };
  } catch (error) {
    console.error(error);
    return { ok: false, error: "Não foi possível salvar as permissões." };
  }
}

const knowledgeSchema = z.object({
  id: z.number().int().positive().optional(),
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(8000),
});

export async function saveKnowledgeAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    const data = knowledgeSchema.parse(input);

    if (data.id) {
      await db
        .update(aiAgentKnowledge)
        .set({ title: data.title, content: data.content, updatedAt: new Date() })
        .where(
          and(eq(aiAgentKnowledge.id, data.id), eq(aiAgentKnowledge.organizationId, ctx.organizationId)),
        );
    } else {
      await db.insert(aiAgentKnowledge).values({
        organizationId: ctx.organizationId,
        title: data.title,
        content: data.content,
      });
    }
    revalidatePath("/agente");
    return { ok: true };
  } catch (error) {
    console.error(error);
    return { ok: false, error: "Não foi possível salvar o material." };
  }
}

export async function deleteKnowledgeAction(id: number): Promise<ActionResult> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    await db
      .delete(aiAgentKnowledge)
      .where(and(eq(aiAgentKnowledge.id, id), eq(aiAgentKnowledge.organizationId, ctx.organizationId)));
    revalidatePath("/agente");
    return { ok: true };
  } catch {
    return { ok: false, error: "Não foi possível remover." };
  }
}

const simulateSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .max(20)
    .default([]),
  customerId: z.number().int().positive().nullable().default(null),
});

export type SimulationResult =
  | { ok: true; reply: string; toolsUsed: string[]; model: string; rounds: number }
  | { ok: false; error: string };

/**
 * Simulador.
 *
 * Chama exatamente a função que atende no WhatsApp, com o mesmo prompt, as
 * mesmas ferramentas e o mesmo pós-processamento. A única diferença é a origem,
 * que impede o efeito de transferência de mexer numa conversa real. Testar por
 * um caminho paralelo daria confiança falsa: já aconteceu de o simulador
 * aprovar respostas que o atendimento real não produzia.
 */
export async function simulateAgentAction(input: unknown): Promise<SimulationResult> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    const data = simulateSchema.parse(input);

    const [agent] = await db
      .select({ status: aiAgents.status, model: aiAgents.model })
      .from(aiAgents)
      .where(eq(aiAgents.organizationId, ctx.organizationId))
      .orderBy(asc(aiAgents.id))
      .limit(1);
    if (!agent) return { ok: false, error: "Configure o agente antes de testar." };
    if (agent.status === "off") return { ok: false, error: "O agente está desligado. Mude para Teste ou Atendendo." };

    const result = await executeAgentTurn({
      organizationId: ctx.organizationId,
      // Zero: o simulador não pertence a nenhuma conversa, e é isso que impede
      // uma ação de teste de vazar para o inbox de um cliente.
      conversationId: 0,
      customerId: data.customerId,
      userText: data.message,
      history: data.history.map((item) => ({ role: item.role, content: item.content })),
      source: "simulator",
    });

    return {
      ok: true,
      reply: result.reply,
      toolsUsed: result.toolsUsed,
      model: result.debug.model,
      rounds: result.debug.rounds,
    };
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Falha ao simular.";
    return { ok: false, error: message.includes("API_KEY") ? "Falta a chave do provedor no servidor." : message };
  }
}

export async function listRecentActivityAction() {
  const ctx = await requireSession();
  const { aiExecutionLogs } = await import("@/db/schema");
  return db
    .select({
      id: aiExecutionLogs.id,
      tool: aiExecutionLogs.tool,
      ok: aiExecutionLogs.ok,
      createdAt: aiExecutionLogs.createdAt,
    })
    .from(aiExecutionLogs)
    .where(eq(aiExecutionLogs.organizationId, ctx.organizationId))
    .orderBy(desc(aiExecutionLogs.createdAt))
    .limit(20);
}
