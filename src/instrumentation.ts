/**
 * Ponto de partida do processo do servidor.
 *
 * O worker do agente sobe junto com a aplicação. A guarda de runtime importa:
 * este arquivo também é avaliado no runtime edge, onde nem Redis nem `pg`
 * existem.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  installCrashLogging();

  if (process.env.AGENT_WORKER_ENABLED === "false") {
    console.warn("[agent worker] desligado por AGENT_WORKER_ENABLED=false");
    return;
  }

  const { startAgentWorker } = await import("@/server/queues/agent-worker");
  startAgentWorker();
}

/**
 * Rede de segurança do processo.
 *
 * Sem isto uma falha em trabalho de fundo derruba o servidor HTTP inteiro sem
 * deixar rastro — o contêiner some do ar e o log termina em silêncio, que é
 * exatamente o que aconteceu em produção. Aqui a causa é registrada e o
 * servidor web continua servindo: uma fila com problema não pode tirar a
 * agenda da clínica do ar.
 */
function installCrashLogging() {
  const g = globalThis as { __crashLoggingInstalled?: boolean };
  if (g.__crashLoggingInstalled) return;
  g.__crashLoggingInstalled = true;

  process.on("unhandledRejection", (reason) => {
    console.error("[processo] promessa rejeitada sem tratamento:", reason);
  });

  process.on("uncaughtException", (error) => {
    console.error("[processo] exceção não tratada:", error);
  });

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      console.warn(`[processo] recebeu ${signal} — encerrando`);
      process.exit(0);
    });
  }
}
