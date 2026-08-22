/**
 * Ponto de partida do processo do servidor.
 *
 * O worker do agente sobe junto com a aplicação. A guarda de runtime importa:
 * este arquivo também é avaliado no runtime edge, onde nem Redis nem `pg`
 * existem.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.AGENT_WORKER_ENABLED === "false") return;

  const { startAgentWorker } = await import("@/server/queues/agent-worker");
  startAgentWorker();
}
