import type { AppointmentStatus } from "@/domain/appointment-status";

/**
 * Faixa lateral de 3px que codifica STATUS — e só status, em toda largura e em
 * toda lista de atendimento (agenda, Hoje, ficha do cliente, financeiro).
 *
 * Identidade do profissional é informação estável e usa o ponto de 6px ao lado
 * do nome; status é o que muda e o que exige ação, então fica no canal de maior
 * alcance periférico.
 */
const STRIPE: Record<AppointmentStatus, string> = {
  scheduled: "var(--color-attention)",
  confirmed: "var(--color-positive)",
  checked_in: "var(--color-info)",
  in_progress: "var(--color-info)",
  completed: "var(--color-line-strong)",
  cancelled: "var(--color-danger)",
  no_show: "var(--color-danger)",
};

export function stripeColor(status: string): string {
  return STRIPE[status as AppointmentStatus] ?? "var(--color-line-strong)";
}

/** Ponto de identidade do profissional. */
export function ProfessionalDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={className ?? "size-1.5 shrink-0 rounded-full"}
      style={{ backgroundColor: color }}
    />
  );
}
