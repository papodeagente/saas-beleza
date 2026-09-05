import "server-only";

/**
 * Rede de segurança do processo Node.
 *
 * Sem isto, uma falha em trabalho de fundo derruba o servidor HTTP inteiro sem
 * deixar rastro — o contêiner some do ar e o log termina em silêncio, que é
 * exatamente o que aconteceu em produção. Aqui a causa é registrada e o
 * servidor web continua servindo: uma fila com problema não pode tirar a
 * agenda da clínica do ar.
 *
 * Vive num módulo próprio porque `process.on` não existe no runtime Edge, e o
 * instrumentation.ts é compilado para os dois.
 */
export function installProcessGuards(): void {
  const g = globalThis as { __processGuardsInstalled?: boolean };
  if (g.__processGuardsInstalled) return;
  g.__processGuardsInstalled = true;

  process.on("unhandledRejection", (reason) => {
    console.error("[processo] promessa rejeitada sem tratamento:", reason);
  });

  process.on("uncaughtException", (error) => {
    console.error("[processo] exceção não tratada:", error);
  });

  // Torna visível um encerramento vindo de fora (docker stop, OOM do host com
  // sinal, redeploy). Sem isto a saída é indistinguível de um crash.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      console.warn(`[processo] recebeu ${signal} — encerrando`);
      process.exit(0);
    });
  }
}
