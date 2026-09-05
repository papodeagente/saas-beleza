import "server-only";
import { dispatchDueMessages } from "@/server/services/scheduled-group-messages";
import { dispatchDueAutomations } from "@/server/services/automation-service";

/**
 * Varredura das mensagens programadas.
 *
 * Um intervalo simples, e não uma fila com atraso: o que decide o envio é a
 * hora gravada na linha, então reiniciar o servidor, perder o Redis ou subir
 * uma versão nova não engole nenhum agendamento — na volta, a varredura acha o
 * que venceu e manda.
 *
 * A precisão é de meio minuto, que é o que faz sentido para um aviso de grupo.
 */

const INTERVALO_MS = 30_000;

declare global {
  var __scheduledMessagesTimer: ReturnType<typeof setInterval> | undefined;
}

export function startScheduledMessagesWorker(): void {
  if (global.__scheduledMessagesTimer) return;

  global.__scheduledMessagesTimer = setInterval(async () => {
    try {
      const resultado = await dispatchDueMessages();
      if (resultado.sent > 0 || resultado.failed > 0) {
        console.log(`[agendadas] enviadas: ${resultado.sent}, falhas: ${resultado.failed}`);
      }
      const automacoes = await dispatchDueAutomations();
      if (automacoes.sent > 0 || automacoes.failed > 0 || automacoes.skipped > 0) {
        console.log(
          `[automações] enviadas: ${automacoes.sent}, falhas: ${automacoes.failed}, ignoradas: ${automacoes.skipped}`,
        );
      }
    } catch (error) {
      // Uma varredura que estoura não pode derrubar as próximas.
      console.error("[agendadas] varredura falhou:", error instanceof Error ? error.message : error);
    }
  }, INTERVALO_MS);

  console.log("[agendadas] varredura ativa");
}
