/**
 * Ponto de partida do processo do servidor.
 *
 * O worker do agente sobe junto com a aplicação. A guarda de runtime importa:
 * este arquivo também é avaliado no runtime edge, onde nem Redis, nem `pg`,
 * nem `process.on` existem — por isso tudo que é de Node entra por import
 * dinâmico, dentro da guarda.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { installProcessGuards } = await import("@/server/process-guards");
  installProcessGuards();

  if (process.env.AGENT_WORKER_ENABLED === "false") {
    console.warn("[agent worker] desligado por AGENT_WORKER_ENABLED=false");
    return;
  }

  const { startAgentWorker } = await import("@/server/queues/agent-worker");
  startAgentWorker();
}
