import "server-only";
import { Worker } from "bullmq";
import { AGENT_TURN_QUEUE, type AgentTurnJob } from "@/server/queues/agent-turn-queue";
import { processAgentTurn } from "@/server/queues/agent-turn-processor";
import { getRedis } from "@/server/queues/redis";

/**
 * Worker dos turnos do agente.
 *
 * Roda dentro do processo do servidor, iniciado por `instrumentation.ts`. Um
 * processo separado seria mais isolado, mas exigiria um segundo contêiner para
 * ganhar pouco: a concorrência é baixa por natureza (uma clínica não recebe
 * centenas de mensagens por segundo) e o trabalho pesado é espera de rede.
 */

declare global {
  var __agentWorker: Worker<AgentTurnJob> | undefined;
}

export function startAgentWorker(): Worker<AgentTurnJob> | null {
  if (global.__agentWorker) return global.__agentWorker;

  const connection = getRedis();
  if (!connection) {
    console.warn("[agent worker] REDIS_URL ausente: o agente de IA não vai responder.");
    return null;
  }

  const worker = new Worker<AgentTurnJob>(
    AGENT_TURN_QUEUE,
    async (job) => {
      const outcome = await processAgentTurn(job.data);
      if (outcome.status !== "sent") {
        console.log(`[agent worker] conv=${job.data.conversationId} ${outcome.status}: ${outcome.reason ?? ""}`);
      }
      return outcome;
    },
    {
      connection,
      // Turnos diferentes rodam juntos; o lock por conversa garante que dois
      // turnos da MESMA conversa nunca se cruzem.
      concurrency: 4,
    },
  );

  worker.on("failed", (job, error) => {
    console.error(`[agent worker] job ${job?.id} falhou:`, error?.message);
  });

  // Obrigatório: um EventEmitter sem ouvinte de "error" derruba o processo Node
  // inteiro. Uma oscilação do Redis não pode tirar a agenda da clínica do ar.
  worker.on("error", (error) => {
    console.error("[agent worker] erro de conexão:", error?.message);
  });

  global.__agentWorker = worker;
  console.log("[agent worker] ativo");
  return worker;
}
