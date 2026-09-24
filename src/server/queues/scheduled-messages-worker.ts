import "server-only";
import { dispatchDueMessages } from "@/server/services/scheduled-group-messages";
import { dispatchDueAutomations } from "@/server/services/automation-service";
import { expirarReservasVencidas } from "@/server/services/booking-payment-service";

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

      /**
       * Reserva que venceu sem pagamento devolve o horário para a grade.
       *
       * Fica nesta varredura, e não numa fila com atraso, pelo mesmo motivo das
       * mensagens: o prazo está gravado na linha. Se o processo cair com dez
       * reservas pendentes, na volta a varredura acha todas — uma fila em
       * memória teria perdido os dez horários para sempre.
       */
      const expiradas = await expirarReservasVencidas();
      if (expiradas > 0) console.log(`[cobrança] reservas expiradas: ${expiradas}`);
    } catch (error) {
      // Uma varredura que estoura não pode derrubar as próximas.
      console.error("[agendadas] varredura falhou:", error instanceof Error ? error.message : error);
    }
  }, INTERVALO_MS);

  console.log("[agendadas] varredura ativa");
}
