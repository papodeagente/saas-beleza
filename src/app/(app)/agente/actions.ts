"use server";

import { and, asc, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { aiAgentKnowledge, aiAgentPermissions, aiAgents } from "@/db/schema";
import { requireRole, requireSession } from "@/server/auth";
import { AGENT_MODELS, DEFAULT_MODEL, hasApiKeyFor, normalizeModel } from "@/server/ai/llm";
import {
  apenasSituacoesConhecidas,
  PERMISSOES_DO_PADRAO,
  TONS,
  USOS_DE_EMOJI,
} from "@/domain/agente";
import { verificarProntidao } from "@/server/services/agent-readiness-service";
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
      // Salvar por esta tela É escolher o modo personalizado: ela edita o campo
      // de instruções, que no modo padrão nem é lido. Sem esta linha, uma conta
      // no padrão que abrisse os ajustes avançados e salvasse continuaria
      // rodando o preset enquanto a tela mostra a caixa de instruções vazia.
      mode: "personalizado" as const,
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

/**
 * O erro que a dona vê.
 *
 * O `catch` devolvia `error.message` cru, e um ZodError serializa a lista de
 * issues inteira: apagar o nome da agente mostrava um JSON no toast em vez da
 * frase escrita para ela.
 */
function mensagemDoErro(error: unknown, padrao: string): string {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? padrao;
  return error instanceof Error ? error.message : padrao;
}

const padraoSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome para a sua agente.").max(60),
  tone: z.enum(TONS),
  emojiUse: z.enum(USOS_DE_EMOJI),
  goal: z.string().trim().max(200).nullable(),
  /**
   * Chave desconhecida é DESCARTADA, não rejeitada.
   *
   * O valor vem de um jsonb gravado por uma versão anterior da tela: quando uma
   * situação sai da lista, toda conta que a tinha marcada deixaria de conseguir
   * salvar — e o erro apareceria como texto do Zod, em inglês, num toast. Medido
   * ao remover "pediu_atendente": a conta de teste travou no primeiro salvamento.
   */
  handoffWhen: z.array(z.string()).transform(apenasSituacoesConhecidas),
  /**
   * `ativo` responde às clientes; `teste` existe só no simulador; `desligado`
   * para tudo. São três porque a dona precisa poder DESLIGAR pela mesma tela em
   * que ligou — sem isso, ativar é uma porta de mão única.
   */
  estado: z.enum(["ativo", "teste", "desligado"]),
});

/**
 * Liga a agente padrão inteira, de uma vez.
 *
 * Por que não dá para reusar `saveAgentAction`: ela só cria a linha de
 * permissões no ramo de INSERT, e sem booleano nenhum. Toda conta que JÁ tem
 * agente — o que inclui todas as que existem hoje em produção — nunca ganharia
 * permissão de escrita por caminho nenhum da tela, e a agente "ativada"
 * conversaria bem sem conseguir marcar nada.
 *
 * E são DOIS interruptores, não um: a fila só enfileira com
 * `status === "active"` E `enabled === true`. Uma conta em produção está hoje
 * com status "active" e `enabled` falso, ou seja, o dono acha que ligou e a
 * agente nunca respondeu. Aqui os dois andam juntos.
 */
export async function ativarAgentePadraoAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    const data = padraoSchema.parse(input);

    const ligando = data.estado === "ativo";
    const prontidao = await verificarProntidao(ctx);
    if (ligando && !prontidao.prontaParaAtender) {
      const faltando = prontidao.itens
        .filter((item) => item.chave !== "whatsapp" && !item.ok)
        .map((item) => item.rotulo.toLowerCase());
      return {
        ok: false,
        error: `Antes de ativar, falta cadastrar: ${faltando.join(", ")}. Sem isso ela não tem o que responder.`,
      };
    }

    const model = normalizeModel(DEFAULT_MODEL);
    if (ligando && !hasApiKeyFor(model)) {
      return { ok: false, error: "Falta a chave do provedor de IA no servidor. Sem ela a agente não responde." };
    }

    const [existing] = await db
      .select({ id: aiAgents.id })
      .from(aiAgents)
      .where(eq(aiAgents.organizationId, ctx.organizationId))
      .orderBy(asc(aiAgents.id))
      .limit(1);

    const values = {
      name: data.name,
      // O modelo é gravado nos DOIS caminhos, e é o mesmo que acabou de passar
      // pela checagem de chave. Sem isto, uma conta que tivesse escolhido outro
      // provedor passava na checagem (feita sobre o padrão) e continuava
      // gravada no modelo antigo: ativava com sucesso e não respondia nunca.
      model,
      mode: "padrao" as const,
      tone: data.tone,
      emojiUse: data.emojiUse,
      goal: data.goal,
      handoffWhen: data.handoffWhen,
      // Os dois interruptores juntos: a fila só enfileira com os DOIS ligados,
      // e uma conta em produção está hoje com status "active" e `enabled`
      // falso, ou seja, o dono acha que ligou e nunca respondeu ninguém.
      status: (data.estado === "ativo" ? "active" : data.estado === "teste" ? "testing" : "off") as
        | "active"
        | "testing"
        | "off",
      enabled: ligando,
      updatedAt: new Date(),
    };

    const agentId = existing
      ? (await db.update(aiAgents).set(values).where(eq(aiAgents.id, existing.id)), existing.id)
      : (
          await db
            .insert(aiAgents)
            .values({ ...values, organizationId: ctx.organizationId, model })
            .returning({ id: aiAgents.id })
        )[0].id;

    // A linha de permissões é garantida nos DOIS caminhos, e os booleanos são
    // escritos explicitamente: `onConflictDoNothing` sozinho deixaria a conta
    // antiga com as escritas desligadas para sempre.
    await db
      .insert(aiAgentPermissions)
      .values({ agentId, organizationId: ctx.organizationId, ...PERMISSOES_DO_PADRAO })
      .onConflictDoUpdate({
        target: aiAgentPermissions.agentId,
        set: { ...PERMISSOES_DO_PADRAO, updatedAt: new Date() },
      });

    invalidateAgentCache(ctx.organizationId);
    revalidatePath("/agente");
    return { ok: true };
  } catch (error) {
    console.error(error);
    return { ok: false, error: mensagemDoErro(error, "Não foi possível ativar.") };
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
