import "server-only";
import { Queue } from "bullmq";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { aiAgents } from "@/db/schema";
import { getRedis } from "@/server/queues/redis";

export const AGENT_TURN_QUEUE = "agent-turn";

export type AgentTurnJob = {
  organizationId: number;
  conversationId: number;
  customerId: number | null;
};

declare global {
  var __agentTurnQueue: Queue<AgentTurnJob> | undefined;
}

export function getAgentTurnQueue(): Queue<AgentTurnJob> | null {
  const connection = getRedis();
  if (!connection) return null;
  if (!global.__agentTurnQueue) {
    global.__agentTurnQueue = new Queue<AgentTurnJob>(AGENT_TURN_QUEUE, {
      connection,
      defaultJobOptions: {
        removeOnComplete: 200,
        removeOnFail: 200,
        attempts: 2,
        backoff: { type: "exponential", delay: 5_000 },
      },
    });
  }
  return global.__agentTurnQueue;
}

// Debounce por organização, com validade curta: evita um SELECT na configuração
// a cada mensagem recebida.
type CacheEntry = { active: boolean; debounceSeconds: number; expiresAt: number };
const CACHE_TTL_MS = 60_000;
const configCache = new Map<number, CacheEntry>();

export function invalidateAgentCache(organizationId: number): void {
  configCache.delete(organizationId);
}

async function agentGate(organizationId: number): Promise<CacheEntry> {
  const now = Date.now();
  const cached = configCache.get(organizationId);
  if (cached && cached.expiresAt > now) return cached;

  const [row] = await db
    .select({
      status: aiAgents.status,
      enabled: aiAgents.enabled,
      debounceWindowSeconds: aiAgents.debounceWindowSeconds,
    })
    .from(aiAgents)
    .where(and(eq(aiAgents.organizationId, organizationId)))
    .limit(1);

  const entry: CacheEntry = {
    // Só o modo "atendendo" com o kill-switch ligado chega a enfileirar.
    active: row?.status === "active" && row?.enabled === true,
    debounceSeconds: row?.debounceWindowSeconds ?? 8,
    expiresAt: now + CACHE_TTL_MS,
  };
  configCache.set(organizationId, entry);
  return entry;
}

/**
 * Agenda o turno do agente.
 *
 * A janela de debounce existe porque cliente escreve em rajada: "oi", "queria
 * marcar", "pode ser quinta?". Sem ela, o agente responde três vezes, cada uma
 * sem o contexto das outras. Cada mensagem nova empurra a janela para frente,
 * então ele só fala quando o cliente termina de escrever.
 *
 * O turno em execução não é cancelado: se a remoção do job falhar porque ele já
 * está rodando, a nova mensagem entra num job próprio em vez de ser descartada.
 * Perder mensagem é pior do que responder duas vezes — e o coalescing no
 * processador cuida do resto.
 */
export async function enqueueAgentTurn(job: AgentTurnJob): Promise<boolean> {
  const queue = getAgentTurnQueue();
  if (!queue) {
    console.warn("[agent] REDIS_URL ausente: turno não enfileirado.");
    return false;
  }

  const gate = await agentGate(job.organizationId);
  if (!gate.active) return false;

  const jobId = `conv:${job.conversationId}`;
  const delay = Math.max(0, gate.debounceSeconds) * 1000;

  try {
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "delayed" || state === "waiting") {
        await existing.remove();
      } else {
        // Já está rodando: entra como job independente, com id único.
        await queue.add("turn", job, { jobId: `${jobId}:${Date.now()}`, delay });
        return true;
      }
    }
  } catch (error) {
    console.warn("[agent] não consegui remover job pendente:", error instanceof Error ? error.message : error);
    await queue.add("turn", job, { jobId: `${jobId}:${Date.now()}`, delay });
    return true;
  }

  await queue.add("turn", job, { jobId, delay });
  return true;
}
