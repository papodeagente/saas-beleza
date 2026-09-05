/**
 * Vocabulário do ciclo de vida do atendimento.
 *
 * Módulo puro (sem I/O, sem "server-only"): é compartilhado por UI e servidor.
 * Rótulo e transições vivem juntos para que a mesma regra apareça na tela e no
 * domínio — a UI nunca inventa um rótulo nem oferece uma transição inválida.
 */

export type AppointmentStatus =
  | "scheduled"
  | "confirmed"
  | "checked_in"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

export const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  scheduled: ["confirmed", "checked_in", "in_progress", "completed", "cancelled", "no_show"],
  confirmed: ["checked_in", "in_progress", "completed", "cancelled", "no_show"],
  checked_in: ["in_progress", "completed", "cancelled", "no_show"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  no_show: [],
};

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: "Agendado",
  confirmed: "Confirmado",
  checked_in: "Check-in feito",
  in_progress: "Em atendimento",
  completed: "Concluído",
  cancelled: "Cancelado",
  no_show: "Faltou",
};

export const STATUS_TONE = {
  scheduled: "neutral",
  confirmed: "positive",
  checked_in: "info",
  in_progress: "info",
  completed: "positive",
  cancelled: "danger",
  no_show: "danger",
} as const;

export const ACTIVE_STATUSES = ["scheduled", "confirmed", "checked_in", "in_progress"] as const;

export function isClosed(status: string): boolean {
  return status === "completed" || status === "cancelled" || status === "no_show";
}

export function nextStatuses(status: AppointmentStatus): AppointmentStatus[] {
  return TRANSITIONS[status];
}
